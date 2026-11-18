// @local/dsh-gpu-fan — Host service.
// The typert remote-binding code below is inlined verbatim from
// @deepseek-ai/dsh-typert-protocol (same pattern as dsh-tmux-context),
// because a pnpm-local bundle resolves imports from its real path, which is
// outside the DSH application's node_modules.
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* @deepseek-ai/cordis is the DSH host framework; it ships inside the running
 * DSH installation's node_modules. This bundle resolves from its real path
 * (outside that tree), so a local node_modules symlink is the normal route.
 * If that lookup has gone stale — e.g. after a DSH version upgrade replaced
 * the install directory and this long-lived process cached the failed lookup
 * — locate cordis inside the live installation and import it directly by
 * file URL (the same resolved module as the host's copy), then repair the
 * local symlink so future boots use the normal path. */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

function locateCordisDir() {
  const candidates = [];
  // 1) The live DSH installation, derived from this process's entry point:
  //    <install>/node_modules/.bin/dsh  →  <install>/node_modules
  try {
    const m = /^(.*\/node_modules)(?:\/.*)?$/.exec(process.argv[1] ?? "");
    if (m) candidates.push(join(m[1], "@deepseek-ai/cordis"));
  } catch {}
  // 2) The DSH application data root: scan versioned installs, newest first.
  try {
    const root = "/vol1/@appdata/Harness/server";
    const versions = readdirSync(root)
      .filter((v) => v !== ".bin" && statSync(join(root, v)).isDirectory())
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) candidates.push(join(root, v, "node_modules/@deepseek-ai/cordis"));
  } catch {}
  for (const dir of candidates) {
    try {
      if (statSync(join(dir, "package.json")).isFile()) return dir;
    } catch {}
  }
  return null;
}

function repairLocalLink(targetDir) {
  try {
    const link = join(PLUGIN_DIR, "node_modules/@deepseek-ai/cordis");
    let st;
    try { st = statSync(link); } catch {}
    if (st) rmSync(link, st.isDirectory() && !st.isSymbolicLink() ? { recursive: true, force: true } : { force: true });
    symlinkSync(targetDir, link);
  } catch {}
}

async function importCordis() {
  try {
    return await import("@deepseek-ai/cordis");
  } catch (err) {
    const dir = locateCordisDir();
    if (!dir) throw err;
    repairLocalLink(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const entry = join(dir, typeof pkg.main === "string" && pkg.main !== "" ? pkg.main : "index.js");
    return import(pathToFileURL(entry).href);
  }
}

const { Context, Service } = await importCordis();

/* ----------------------- inlined typert protocol ----------------------- */
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function isTypertRemoteSegment(value) {
  return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
function validateName(subject, value) {
  if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}
function bindTypertRemote(service, serviceKey, options = {}) {
  validateName("service key", serviceKey);
  const namespace = options.namespace ?? serviceKey;
  validateName("namespace", namespace);
  const ctx = Reflect.get(service, "ctx");
  if (Context.is(ctx)) provideInvocationAccessor(ctx);
  return Object.freeze({
    service,
    serviceKey,
    namespace,
  });
}
class TypertRemoteService extends Service {
  constructor(ctx, serviceKey, options = {}) {
    super(ctx, serviceKey);
    this.typertRemote = bindTypertRemote(this, this.name, options);
  }
}
function provideInvocationAccessor(ctx) {
  if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
  ctx.root.accessor("invocation", { get: () => void 0 });
}
function readRemoteMethodDescriptor(prototype) {
  const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
  if (property === void 0) return void 0;
  const descriptor = property.value;
  if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
  if (Reflect.get(descriptor, "version") !== 1) throw new TypeError("typert-protocol: unsupported Remote method descriptor version");
  const methods = Reflect.get(descriptor, "methods");
  if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
  return descriptor;
}
function sameInvocation(left, right) {
  if (left.kind === "direct") return right.kind === "direct";
  if (right.kind === "direct") return false;
  return left.context === right.context;
}
function mark(prototype, method, invocation) {
  const descriptor = readRemoteMethodDescriptor(prototype);
  const marker = Object.freeze({ method, invocation: Object.freeze(invocation) });
  const current = descriptor?.methods.find((candidate) => candidate.method === method);
  if (current !== void 0) {
    if (current.exportName === marker.exportName && current.mode === marker.mode && current.resources === marker.resources && sameInvocation(current.invocation, invocation)) return;
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...descriptor?.methods ?? [], marker]),
    }),
  });
}

/* ------------------------------- service ------------------------------- */
const NVFAN_BIN = "/opt/nvfan/nvfan";
const NVFAN_CONF = "/etc/nvfan.conf";

/** Run a command; resolve (never throw) so remote calls surface errors as values. */
function run(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8", timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, error: ((stderr || error.message || String(error)) + "").trim() });
      else resolve({ ok: true, stdout: (stdout || "").trim() });
    });
  });
}

function readCurve() {
  try {
    const conf = JSON.parse(readFileSync(NVFAN_CONF, "utf8"));
    return Array.isArray(conf.curve) ? conf.curve : [];
  } catch {
    return [];
  }
}

function normalizeCurve(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 32) {
    throw new Error("curve needs 2-32 [temp, pct] points");
  }
  const norm = points.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(`curve point ${i} must be [temp:number, pct:number]`);
    }
    if (p[0] < 0 || p[0] > 120) throw new Error(`curve point ${i}: temp ${p[0]} out of 0-120`);
    if (p[1] < 30 || p[1] > 100) throw new Error(`curve point ${i}: pct ${p[1]} out of 30-100 (driver floor is 30)`);
    return [Math.round(p[0]), Math.round(p[1])];
  });
  norm.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of norm) {
    if (out.length > 0 && out[out.length - 1][0] === p[0]) out[out.length - 1] = p;
    else out.push(p);
  }
  if (out.length < 2) throw new Error("curve needs at least 2 distinct temps");
  return out;
}

class GpuFan extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, "gpuFan");
    this.config = config;
  }

  /** Live GPU temperature, both fans (current/target/policy) and the active curve. */
  async status() {
    const res = await run(NVFAN_BIN, ["status"]);
    if (!res.ok) return { ok: false, error: res.error };
    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      return { ok: false, error: "nvfan status: not valid JSON" };
    }
    const fans = Object.entries(data.fans ?? {}).map(([name, f]) => ({
      name,
      cur: Number(f.cur_pct) || 0,
      target: Number(f.target_pct) || 0,
      policy: Number(f.policy) || 0,
    }));
    const gpu = {
      name: typeof data.gpu_name === "string" ? data.gpu_name : "",
      driver: typeof data.driver === "string" ? data.driver : "",
      memTotal: Number(data.mem?.total) || 0,
      memUsed: Number(data.mem?.used) || 0,
      utilGpu: Number(data.util?.gpu) || 0,
      utilMem: Number(data.util?.mem) || 0,
      powerW: Number(data.power_mw) / 1000,
      powerLimitW: Number(data.power_limit_mw) / 1000,
      clockMhz: Number(data.clock_mhz) || 0,
      memClockMhz: Number(data.mem_clock_mhz) || 0,
    };
    return {
      ok: true,
      temp: Number(data.gpu_temp_c) || 0,
      fans,
      gpu,
      curve: readCurve(),
      daemon: data.daemon_state ?? null,
    };
  }

  /** Replace the temperature→fan% curve and return control to curve mode; the daemon hot-reloads within one poll (≤2 s). */
  async setCurve(points) {
    const curve = normalizeCurve(points);
    const args = curve.map(([t, p]) => `${t}:${p}`);
    const res = await run("sudo", ["-n", NVFAN_BIN, "curve", ...args]);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, curve };
  }

  /** Pin both fans to a fixed percent now; the daemon holds the pin until auto or a new curve is saved. */
  async setPct(pct) {
    if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 30 || pct > 100) {
      throw new Error("pct must be an integer in 30-100");
    }
    const res = await run("sudo", ["-n", NVFAN_BIN, "set", String(pct)]);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, pct };
  }

  /** Hand control back to the driver (automatic); the daemon stops applying the curve until a pin or a new curve is saved. */
  async auto() {
    const res = await run("sudo", ["-n", NVFAN_BIN, "auto"]);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true };
  }
}

// Mark remote methods directly on the prototype (same descriptor shape the
// @Remote decorator writes; see dsh-tmux-context for the inline pattern).
function markRemote(cls, name) {
  mark(cls.prototype, name, { kind: "direct" });
}
for (const name of ["status", "setCurve", "setPct", "auto"]) markRemote(GpuFan, name);

export { GpuFan as default };
