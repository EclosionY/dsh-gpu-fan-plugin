// @local/dsh-gpu-fan — GPU fan panel (client bundle, delivered to the browser as-is)
// Entry point: left sidebar panel (sidebar.panellist) + full page (main key "gpuFan").
window.__ModuleLoader__.load({
  id: "@local/dsh-gpu-fan",
  factory: (require) => {
    const dbg = (k, v) => {
      if (typeof window !== "undefined") {
        window.__gpf_dbg = Object.assign(window.__gpf_dbg || {}, { [k]: v !== undefined ? v : Date.now() });
      }
    };
    dbg("factory");
    const React = require("react");
    dbg("react");
    const z = require("zod");
    dbg("zod");

    /* ------------------------------------------------------------------ *
     * Vendored: createTypertRemoteInfo (from @deepseek-ai/dsh-typert-protocol
     * lib/types/remote-info.js — "no runtime imports", uses caller zod).
     * The browser module table has no row for the protocol package, so the
     * generated-contribution helper is inlined exactly as the official
     * build-time generator inlines it.
     * ------------------------------------------------------------------ */
    function createTypertRemoteInfo(spec, zod) {
      return new RemoteInfo(spec, zod);
    }
    class RemoteInfo {
      constructor(spec, zod) {
        this.spec = spec;
        this.zod = zod;
        this.index = undefined;
      }
      get package() { return this.spec.package; }
      get descriptors() { return this.resolve().descriptors; }
      get methods() { return this.resolve().methods; }
      resolve() {
        if (this.index !== undefined) return this.index;
        const zod = this.zod;
        const descriptors = [];
        const methods = Object.create(null);
        for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
          const separator = endpoint.indexOf("/");
          const namespace = endpoint.slice(0, separator);
          const method = endpoint.slice(separator + 1);
          const parameters = definition.parameters.map((parameter) => ({ ...parameter, wire: parameter.wire ?? parameter.name }));
          const descriptor = {
            ...definition,
            id: `${this.spec.package}#${endpoint}`,
            namespace,
            method,
            parameters,
            result: definition.result.description === undefined ? definition.result : new ResultValue(definition.result),
          };
          if (definition.invocation.kind === "direct") {
            const inputs = [];
            const direct = Object.assign(descriptor, {
              input(options) {
                const strict = options?.strict === true;
                return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod);
              },
              invoke(remote, input, signal) {
                const named = input;
                const values = parameters.map((parameter) => named[parameter.wire]);
                if (definition.cancellation !== undefined) values.push(signal);
                const receiver = Reflect.get(remote, namespace);
                const call = Reflect.get(receiver, method);
                return call.apply(receiver, values);
              },
            });
            methods[endpoint] = direct;
          }
          descriptors.push(descriptor);
        }
        return (this.index = { descriptors, methods });
      }
    }
    function optional(parameter) {
      return parameter.source === "json" && parameter.acceptsUndefined === true;
    }
    class NamedInput {
      constructor(parameters, strict, zod) {
        this.parameters = parameters;
        this.strict = strict;
        this.zod = zod;
        this.schema = undefined;
        this.projection = undefined;
      }
      codec(parameter) {
        return this.strict ? parameter.strictCodec : parameter.codec;
      }
      create = () =>
        (this.schema ??= this.zod.strictObject(
          Object.fromEntries(
            this.parameters.map((parameter) => {
              const value = this.codec(parameter).create();
              return [parameter.wire, optional(parameter) ? value.optional() : value.nonoptional()];
            })
          )
        ));
      get jsonSchema() { return this.project().jsonSchema; }
      get jsonSchemaError() { return this.project().jsonSchemaError; }
      project() {
        if (this.projection !== undefined) return this.projection;
        const unavailable = this.parameters.find((parameter) => this.codec(parameter).jsonSchema === undefined);
        if (unavailable !== undefined) {
          return (this.projection = { jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}` });
        }
        return (this.projection = {
          jsonSchema: {
            type: "object",
            properties: Object.fromEntries(
              this.parameters.map((parameter) => [parameter.wire, {
                ...this.codec(parameter).jsonSchema,
                ...(parameter.description === undefined ? {} : { description: parameter.description }),
              }])
            ),
            required: this.parameters.filter((parameter) => !optional(parameter)).map((parameter) => parameter.wire),
            additionalProperties: false,
          },
        });
      }
    }
    class ResultValue {
      constructor(spec) { this.spec = spec; this.projection = undefined; }
      get mode() { return this.spec.mode; }
      get typeSymbol() { return this.spec.typeSymbol; }
      get create() { return this.spec.create; }
      get decode() { return this.spec.decode; }
      get encode() { return this.spec.encode; }
      get description() { return this.spec.description; }
      get jsonSchemaError() { return this.spec.jsonSchemaError; }
      get jsonSchema() {
        if (this.projection === undefined) {
          const schema = this.spec.jsonSchema;
          this.projection = { value: schema === undefined ? undefined : { ...schema, description: this.spec.description } };
        }
        return this.projection.value;
      }
    }

    /* ------------------------------ schemas ------------------------------ */
    const point$ = () => z.tuple([z.number(), z.number()]);
    const points$ = () => z.array(point$());
    const gpu$ = () =>
      z.object({
        name: z.string(),
        driver: z.string(),
        memTotal: z.number(),
        memUsed: z.number(),
        utilGpu: z.number(),
        utilMem: z.number(),
        powerW: z.number(),
        powerLimitW: z.number(),
        clockMhz: z.number(),
        memClockMhz: z.number(),
      });
    const status$ = () =>
      z.object({
        ok: z.boolean(),
        temp: z.number().optional(),
        fans: z.array(z.object({ name: z.string(), cur: z.number(), target: z.number(), policy: z.number() })).optional(),
        gpu: gpu$().optional(),
        curve: z.array(point$()).optional(),
        daemon: z.any().nullable().optional(),
        error: z.string().optional(),
      });
    const okCurve$ = () => z.object({ ok: z.boolean(), curve: z.array(point$()).optional(), error: z.string().optional() });
    const okPct$ = () => z.object({ ok: z.boolean(), pct: z.number().optional(), error: z.string().optional() });
    const ok$ = () => z.object({ ok: z.boolean(), error: z.string().optional() });

    const TYPERT_REMOTE = createTypertRemoteInfo({
      package: "@local/dsh-gpu-fan",
      methods: {
        "gpuFan/status": {
          service: "gpuFan",
          description: "Live GPU temperature, per-fan current/target/policy and the active curve",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan#gpuFan/status:result", create: status$ },
        },
        "gpuFan/setCurve": {
          service: "gpuFan",
          description: "Replace the temperature→fan% curve (daemon hot-reloads within ~2 s)",
          invocation: { kind: "direct" },
          parameters: [
            {
              name: "points",
              description: "[temp, pct] pairs, 2-32 points, pct clamped to driver floor 30",
              source: "json",
              codec: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan/types#FanCurve", create: points$ },
              strictCodec: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan/types#FanCurve", create: points$ },
            },
          ],
          result: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan#gpuFan/setCurve:result", create: okCurve$ },
        },
        "gpuFan/setPct": {
          service: "gpuFan",
          description: "Pin all fans to a fixed percent now",
          invocation: { kind: "direct" },
          parameters: [
            {
              name: "pct",
              description: "fan speed percent, integer 30-100",
              source: "json",
              codec: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan/types#Percent", create: () => z.number() },
              strictCodec: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan/types#Percent", create: () => z.number() },
            },
          ],
          result: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan#gpuFan/setPct:result", create: okPct$ },
        },
        "gpuFan/auto": {
          service: "gpuFan",
          description: "Restore driver-automatic fan control",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "@local/dsh-gpu-fan#gpuFan/auto:result", create: ok$ },
        },
      },
    }, z);

    /* ------------------------------- locale ------------------------------ */
    const NS = "gpuFan";
    const dictionaries = {
      zh: {
        "panel": "GPU 风扇",
        "gpuFan.title": "显卡风扇控制",
        "gpuFan.live": "实时",
        "gpuFan.device": "设备",
        "gpuFan.mem": "显存",
        "gpuFan.utilGpu": "GPU 利用率",
        "gpuFan.utilMem": "显存利用率",
        "gpuFan.power": "功耗",
        "gpuFan.clock": "核心频率",
        "gpuFan.memClock": "显存频率",
        "gpuFan.driver": "驱动",
        "gpuFan.tempFans": "温度与风扇",
        "gpuFan.temp": "温度",
        "gpuFan.fan": "风扇 {n}",
        "gpuFan.cur": "当前",
        "gpuFan.target": "目标",
        "gpuFan.curve": "温度曲线",
        "gpuFan.addPoint": "＋ 加点",
        "gpuFan.removePoint": "删除",
        "gpuFan.saveCurve": "保存曲线",
        "gpuFan.defaultCurve": "恢复默认",
        "gpuFan.saved": "曲线已保存，守护进程 2 秒内生效",
        "gpuFan.error": "出错了：{msg}",
        "gpuFan.offline": "读取失败",
        "gpuFan.quick": "快速操作",
        "gpuFan.applyNow": "立即生效",
        "gpuFan.auto": "恢复自动",
        "gpuFan.daemon": "守护",
        "gpuFan.mode.curve": "曲线",
        "gpuFan.mode.manual": "手动",
        "gpuFan.mode.auto": "自动",
        "gpuFan.policy.auto": "自动",
        "gpuFan.policy.manual": "手动",
        "gpuFan.hint": "驱动下限 30%；点 = 温度°C → 转速%",
      },
      en: {
        "panel": "GPU Fan",
        "gpuFan.title": "GPU fan control",
        "gpuFan.live": "LIVE",
        "gpuFan.device": "Device",
        "gpuFan.mem": "VRAM",
        "gpuFan.utilGpu": "GPU usage",
        "gpuFan.utilMem": "VRAM usage",
        "gpuFan.power": "Power",
        "gpuFan.clock": "Core clock",
        "gpuFan.memClock": "Memory clock",
        "gpuFan.driver": "Driver",
        "gpuFan.tempFans": "Temp & fans",
        "gpuFan.temp": "Temp",
        "gpuFan.fan": "Fan {n}",
        "gpuFan.cur": "cur",
        "gpuFan.target": "target",
        "gpuFan.curve": "Temp curve",
        "gpuFan.addPoint": "+ Add point",
        "gpuFan.removePoint": "remove",
        "gpuFan.saveCurve": "Save curve",
        "gpuFan.defaultCurve": "Reset default",
        "gpuFan.saved": "Curve saved — daemon applies it within ~2 s",
        "gpuFan.error": "Error: {msg}",
        "gpuFan.offline": "read failed",
        "gpuFan.quick": "Quick actions",
        "gpuFan.applyNow": "Apply",
        "gpuFan.auto": "Auto",
        "gpuFan.daemon": "daemon",
        "gpuFan.mode.curve": "curve",
        "gpuFan.mode.manual": "manual",
        "gpuFan.mode.auto": "auto",
        "gpuFan.policy.auto": "auto",
        "gpuFan.policy.manual": "manual",
        "gpuFan.hint": "Driver floor 30%; point = temp°C → fan%",
      },
    };

    /* -------------------------------- CSS -------------------------------- */
    const CSS = [
      ".gpf-page{height:100%;overflow:auto;position:relative;background:radial-gradient(1100px 480px at 50% -12%, rgba(59,130,246,.10), transparent 62%), var(--dsw-alias-bg-module-platform,#222222);color:var(--dsw-alias-label-primary,#e2e2e2);}",
      ".gpf-card{max-width:720px;margin:0 auto;padding:26px 20px 44px;display:flex;flex-direction:column;gap:14px;font-size:13px;}",
      ".gpf-head{display:flex;align-items:center;gap:11px;flex-wrap:wrap;}",
      ".gpf-logo{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;color:#fff;flex:none;background:linear-gradient(135deg,#22d3ee,#3b82f6 55%,#6366f1);box-shadow:0 4px 16px rgba(59,130,246,.38);}",
      ".gpf-title{font-size:17px;font-weight:700;letter-spacing:-.01em;}",
      ".gpf-live{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.09em;color:#10b981;padding:3px 10px;border-radius:999px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.38);}",
      ".gpf-live i{width:6px;height:6px;border-radius:50%;background:#10b981;animation:gpfPulse 1.6s ease-in-out infinite;}",
      "@keyframes gpfPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.72)}}",
      ".gpf-chip{font-size:11px;font-weight:500;padding:3px 10px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,#2d2d2d);border:1px solid var(--dsw-alias-border-l2,#4a4a4a);color:var(--dsw-alias-label-secondary,#a8a8a8);}",
      ".gpf-chip.gpf-daemon{margin-left:auto;}",
      ".gpf-err{color:var(--dsw-alias-state-error-primary,#d05050);font-size:12px;}",
      ".gpf-hint{color:var(--dsw-alias-label-tertiary,#808080);font-size:11px;}",
      ".gpf-toast{position:absolute;top:16px;right:16px;z-index:5;display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;padding:8px 15px;border-radius:999px;background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.45);color:#10b981;box-shadow:0 8px 24px rgba(0,0,0,.28);animation:gpfIn .22s ease;max-width:70%;}",
      ".gpf-toast .gpf-toastx{cursor:pointer;opacity:.7;font-size:13px;padding:0 2px;}",
      ".gpf-toast .gpf-toastx:hover{opacity:1;}",
      "@keyframes gpfIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}",
      ".gpf-sec{display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2,#3d3d3d);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#262626);padding:15px 16px 14px;box-shadow:0 1px 2px rgba(0,0,0,.16);}",
      ".gpf-sec h4{margin:0;display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#a8a8a8);text-transform:uppercase;letter-spacing:.06em;}",
      ".gpf-sec h4 svg{color:var(--dsw-alias-state-business-primary,#7aa2f7);flex:none;}",
      /* hero: temp + fans */
      ".gpf-hero{display:flex;align-items:center;gap:22px;flex-wrap:wrap;}",
      ".gpf-tempwrap{display:flex;flex-direction:column;gap:6px;min-width:132px;}",
      ".gpf-temp{display:flex;align-items:baseline;gap:2px;}",
      ".gpf-big{font-size:42px;font-weight:750;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;transition:color .5s;}",
      ".gpf-big .gpf-deg{font-size:20px;font-weight:650;margin-left:1px;}",
      ".gpf-templabel{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a8a);letter-spacing:.06em;text-transform:uppercase;}",
      ".gpf-fans{flex:1;display:flex;flex-direction:column;gap:12px;min-width:270px;}",
      ".gpf-fanline{display:flex;flex-direction:column;gap:6px;}",
      ".gpf-fanmeta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#a8a8a8);}",
      ".gpf-fanval{margin-left:auto;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#e2e2e2);font-size:12.5px;}",
      ".gpf-fanval .gpf-farrow{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-weight:500;}",
      ".gpf-fanbar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#333333);}",
      ".gpf-fanbar i{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#3b82f6);transition:width .7s cubic-bezier(.4,0,.2,1);}",
      ".gpf-fanbar em{position:absolute;top:-2.5px;bottom:-2.5px;width:2.5px;border-radius:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);transition:left .7s cubic-bezier(.4,0,.2,1);}",
      ".gpf-pol{font-size:10px;font-weight:650;padding:1.5px 8px;border-radius:999px;white-space:nowrap;letter-spacing:.02em;border:1px solid var(--dsw-alias-border-l2,#4a4a4a);color:var(--dsw-alias-label-secondary,#a8a8a8);}",
      ".gpf-pol.auto{color:#10b981;border-color:rgba(16,185,129,.5);background:rgba(16,185,129,.1);}",
      ".gpf-pol.manual{color:#3b82f6;border-color:rgba(59,130,246,.5);background:rgba(59,130,246,.1);}",
      /* stat tiles */
      ".gpf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}",
      ".gpf-tile{display:flex;flex-direction:column;gap:7px;padding:12px 12px 11px;border:1px solid var(--dsw-alias-border-l2,#3a3a3a);border-radius:13px;background:var(--dsw-alias-bg-layer-1,#232323);min-width:0;transition:border-color .18s,transform .18s,box-shadow .18s;}",
      ".gpf-tile:hover{border-color:rgba(59,130,246,.55);transform:translateY(-1.5px);box-shadow:0 8px 20px rgba(0,0,0,.26);}",
      ".gpf-tilehead{display:flex;align-items:center;gap:7px;}",
      ".gpf-tileicon{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:rgba(59,130,246,.14);color:#3b82f6;flex:none;}",
      ".gpf-k{font-size:10.5px;font-weight:650;color:var(--dsw-alias-label-tertiary,#8a8a8a);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".gpf-v{font-size:16px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}",
      ".gpf-s{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".gpf-bar{height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#333333);overflow:hidden;}",
      ".gpf-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#3b82f6);transition:width .7s cubic-bezier(.4,0,.2,1);}",
      /* curve */
      ".gpf-chart{border-radius:12px;background:var(--dsw-alias-bg-layer-1,#202020);border:1px solid var(--dsw-alias-border-l2,#3a3a3a);padding:8px 10px 4px;}",
      ".gpf-chart svg{display:block;width:100%;height:auto;}",
      ".gpf-crowlist{display:flex;flex-direction:column;gap:6px;}",
      ".gpf-row{display:flex;align-items:center;gap:8px;}",
      ".gpf-row .gpf-unit{color:var(--dsw-alias-label-tertiary,#808080);font-size:11px;font-weight:650;width:20px;}",
      ".gpf-row input[type=number]{width:62px;padding:6px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,#4a4a4a);background:var(--dsw-alias-bg-layer-2,#232323);color:var(--dsw-alias-label-primary,#e2e2e2);font-size:13px;font-variant-numeric:tabular-nums;transition:border-color .15s,box-shadow .15s;}",
      ".gpf-row input[type=number]:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.25);}",
      ".gpf-row .gpf-arrow{color:var(--dsw-alias-label-tertiary,#808080);font-size:13px;}",
      ".gpf-row .gpf-x{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#808080);cursor:pointer;font-size:14px;line-height:1;padding:3px 7px;border-radius:7px;transition:background .15s,color .15s;}",
      ".gpf-row .gpf-x:hover{color:#ef4444;background:rgba(239,68,68,.12);}",
      /* buttons + controls */
      ".gpf-btn{border:1px solid var(--dsw-alias-border-l2,#4a4a4a);background:var(--dsw-alias-interactive-bg-hover,#2d2d2d);color:var(--dsw-alias-label-primary,#e2e2e2);border-radius:9px;padding:7px 15px;font-size:12.5px;font-weight:650;cursor:pointer;transition:background .15s,border-color .15s,transform .15s,box-shadow .15s;}",
      ".gpf-btn:hover{background:var(--dsw-alias-interactive-bg-active,#3a3a3a);transform:translateY(-1px);}",
      ".gpf-btn:active{transform:translateY(0);}",
      ".gpf-btn.primary{background:linear-gradient(135deg,#3b82f6,#6366f1);border-color:transparent;color:#fff;box-shadow:0 4px 14px rgba(59,130,246,.35);}",
      ".gpf-btn.primary:hover{background:linear-gradient(135deg,#4d8ff8,#7476f2);box-shadow:0 6px 18px rgba(59,130,246,.45);}",
      ".gpf-btn:disabled{opacity:.55;cursor:default;transform:none;box-shadow:none;}",
      ".gpf-range{flex:1;max-width:280px;height:20px;accent-color:#3b82f6;cursor:pointer;}",
      ".gpf-pintval{font-weight:700;font-variant-numeric:tabular-nums;min-width:46px;text-align:right;font-size:13.5px;}",
    ].join("\n");
    const CSS_TAG_ID = "@local/dsh-gpu-fan/gpu-fan";
    function injectCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@local/dsh-gpu-fan";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      dbg("css");
    }
    // Injected at module scope so its presence proves the factory ran.
    injectCss();

    /* ------------------------------ icons -------------------------------- */
    const svgBase = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
    const Icon = (d, size = 15) =>
      React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", ...svgBase },
        d.split("|").map((seg, i) => React.createElement("path", { key: i, d: seg }))
      );
    const FanIcon = ({ size = 18 }) =>
      React.createElement(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", ...svgBase, strokeWidth: 2 },
        React.createElement("path", { d: "M12 12c0-3 2.5-4.5 5-4.5M12 12c3 0 4.5 2.5 4.5 5M12 12c0 3-2.5 4.5-5 4.5M12 12c-3 0-4.5-2.5-4.5-5M12 12c0-6 6-6 6 0M12 12c6 0 6 6 0 6M12 12c-6 0-6-6 0-6M12 12c0 6-6 6-6 0M12 12c-6 0-6-6 0-6" }),
        React.createElement("circle", { cx: 12, cy: 12, r: 1.6, fill: "currentColor", stroke: "none" })
      );
    const IcoChip = () => Icon("M9 9h6v6H9z|M5 9h2M5 15h2M17 9h2M17 15h2M9 5v2M15 5v2M9 17v2M15 17v2");
    const IcoPulse = () => Icon("M3 12h4l2.5 6 4-12 2.5 6H21");
    const IcoLayers = () => Icon("M12 3 3 8l9 5 9-5-9-5|M3 13l9 5 9-5");
    const IcoBolt = () => Icon("M13 2 4 14h6l-1 8 9-12h-6l1-8");
    const IcoGauge = () => React.createElement("svg", { width: 15, height: 15, viewBox: "0 0 24 24", ...svgBase },
      React.createElement("path", { d: "M4 17a8 8 0 1 1 16 0" }),
      React.createElement("path", { d: "M12 17l4.5-5" }),
      React.createElement("circle", { cx: 12, cy: 17, r: 1.4, fill: "currentColor", stroke: "none" })
    );
    const IcoTag = () => React.createElement("svg", { width: 15, height: 15, viewBox: "0 0 24 24", ...svgBase },
      React.createElement("path", { d: "M20 12.5 11.5 21 3 12.5V4h8.5z" }),
      React.createElement("circle", { cx: 7.5, cy: 8.5, r: 1.3, fill: "currentColor", stroke: "none" })
    );
    const IcoThermo = () => React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 24 24", ...svgBase },
      React.createElement("path", { d: "M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z" })
    );
    const IcoCurve = () => React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 24 24", ...svgBase },
      React.createElement("path", { d: "M4 19h16M4 19V4" }),
      React.createElement("path", { d: "M7 15c3-6 6-8 11-9" })
    );
    const IcoZap = () => IcoBolt();

    // Sidebar row icon; the sidebar renders it with {size, active}.
    function GpuFanPanelIcon({ size = 18, active = false }) {
      return React.createElement(
        "span",
        { className: active ? "gpf-icon active" : "gpf-icon", style: { color: active ? "var(--dsw-alias-state-business-primary,#7aa2f7)" : "currentColor", display: "inline-flex" } },
        FanIcon({ size })
      );
    }

    /* ------------------------------ helpers ------------------------------ */
    const GB = 1073741824;
    const fmtGB = (n) => (n / GB).toFixed(1);
    const DEFAULT_CURVE = [[30, 30], [45, 30], [60, 45], [70, 60], [80, 85], [90, 100]];
    const clampPct = (n) => Math.max(0, Math.min(100, n));
    const tempColor = (t) => (t === null || !Number.isFinite(t) ? "var(--dsw-alias-label-primary,#e2e2e2)" : t < 55 ? "#10b981" : t < 75 ? "#f59e0b" : "#ef4444");

    function StatTile({ label, value, sub, pct, icon }) {
      return React.createElement(
        "div",
        { className: "gpf-tile" },
        React.createElement(
          "div",
          { className: "gpf-tilehead" },
          React.createElement("span", { className: "gpf-tileicon" }, icon),
          React.createElement("span", { className: "gpf-k" }, label)
        ),
        React.createElement("div", { className: "gpf-v" }, value),
        pct !== null && pct !== undefined && Number.isFinite(pct)
          ? React.createElement(
              "div",
              { className: "gpf-bar" },
              React.createElement("i", { style: { width: `${clampPct(pct)}%` } })
            )
          : null,
        sub ? React.createElement("div", { className: "gpf-s" }, sub) : null
      );
    }

    // SVG preview of the temperature→fan% curve with a live-temp marker.
    function CurveChart({ points, temp }) {
      const W = 320, H = 116, PX = 34, PT = 12, PB = 22;
      if (!points || points.length < 2) return null;
      const sorted = [...points].sort((a, b) => a[0] - b[0]);
      const tMin = sorted[0][0], tMax = sorted[sorted.length - 1][0];
      const x = (v) => PX + ((v - tMin) / Math.max(1, tMax - tMin)) * (W - PX - 10);
      const y = (v) => H - PB - (clampPct(v) / 100) * (H - PT - PB);
      const line = sorted.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
      const area = `${line} L${x(tMax).toFixed(1)} ${H - PB} L${x(tMin).toFixed(1)} ${H - PB} Z`;
      const grid = [0, 50, 100];
      const tx = temp !== null && Number.isFinite(temp) && temp >= tMin && temp <= tMax ? x(temp) : null;
      return React.createElement(
        "div",
        { className: "gpf-chart" },
        React.createElement(
          "svg",
          { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "curve" },
          React.createElement(
            "defs",
            null,
            React.createElement(
              "linearGradient", { id: "gpfLineGrad", x1: "0", y1: "0", x2: "1", y2: "0" },
              React.createElement("stop", { offset: "0%", stopColor: "#22d3ee" }),
              React.createElement("stop", { offset: "100%", stopColor: "#6366f1" })
            ),
            React.createElement(
              "linearGradient", { id: "gpfAreaGrad", x1: "0", y1: "0", x2: "0", y2: "1" },
              React.createElement("stop", { offset: "0%", stopColor: "#3b82f6", stopOpacity: "0.34" }),
              React.createElement("stop", { offset: "100%", stopColor: "#3b82f6", stopOpacity: "0.02" })
            )
          ),
          grid.map((g) =>
            React.createElement("g", { key: g },
              React.createElement("line", { x1: PX, x2: W - 8, y1: y(g), y2: y(g), stroke: "var(--dsw-alias-border-l2,#3a3a3a)", strokeWidth: 1, strokeDasharray: g === 50 ? "3 4" : "0" }),
              React.createElement("text", { x: PX - 2, y: y(g) + 3, textAnchor: "end", fontSize: "9", style: { fill: "var(--dsw-alias-label-tertiary,#8a8a8a)" } }, `${g}%`)
            )
          ),
          React.createElement("path", { d: area, fill: "url(#gpfAreaGrad)" }),
          React.createElement("path", { d: line, fill: "none", stroke: "url(#gpfLineGrad)", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }),
          sorted.map((p, i) =>
            React.createElement("circle", { key: i, cx: x(p[0]), cy: y(p[1]), r: 3.4, fill: "#fff", stroke: "#3b82f6", strokeWidth: 2 })
          ),
          React.createElement("text", { x: x(tMin), y: H - 8, textAnchor: "start", fontSize: "9.5", style: { fill: "var(--dsw-alias-label-tertiary,#8a8a8a)" } }, `${Math.round(tMin)}°`),
          React.createElement("text", { x: x(tMax), y: H - 8, textAnchor: "end", fontSize: "9.5", style: { fill: "var(--dsw-alias-label-tertiary,#8a8a8a)" } }, `${Math.round(tMax)}°`),
          tx !== null
            ? React.createElement(
                "g",
                null,
                React.createElement("line", { x1: tx, x2: tx, y1: PT - 2, y2: H - PB, stroke: "#f59e0b", strokeWidth: 1.5, strokeDasharray: "3 3" }),
                React.createElement("text", { x: Math.min(W - 10, Math.max(PX, tx)), y: PT - 1, textAnchor: "middle", fontSize: "9.5", fontWeight: "700", style: { fill: "#f59e0b" } }, `${Math.round(temp)}°`)
              )
            : null
        )
      );
    }

    // Full page shown in the main area when the sidebar entry is selected.
    function GpuFanPage(props) {
      const t = props.t;
      const remote = props.api;
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [points, setPoints] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [pinPct, setPinPct] = React.useState(60);
      const noticeTimer = React.useRef(null);

      const flash = React.useCallback((msg) => {
        setNotice(msg);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 4000);
      }, []);

      const refresh = React.useCallback(async () => {
        try {
          const s = await remote.status();
          if (!s.ok) {
            setError(s.error || t("gpuFan.offline"));
            return;
          }
          const v = s.value;
          if (v && v.ok) {
            setStatus(v);
            setError(null);
            setPoints((prev) =>
              prev === null
                ? v.curve && v.curve.length >= 2
                  ? v.curve.map((p) => [p[0], p[1]])
                  : DEFAULT_CURVE.map((p) => [p[0], p[1]])
                : prev
            );
          } else {
            setError((v && v.error) || t("gpuFan.offline"));
          }
        } catch (e) {
          setError(String((e && e.message) || e));
        }
      }, [remote, t]);

      React.useEffect(() => {
        refresh();
        const id = setInterval(refresh, 2000);
        return () => clearInterval(id);
      }, [refresh]);
      React.useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

      const saveCurve = async () => {
        if (!points) return;
        const clean = points
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map((p) => [Math.round(p[0]), Math.round(p[1])]);
        setBusy("save");
        try {
          const r = await remote.setCurve(clean);
          const v = r.ok ? r.value : null;
          if (!r.ok || (v && v.ok === false)) {
            setError((r.ok ? v && v.error : r.error) || t("gpuFan.offline"));
          } else {
            if (v && v.curve && v.curve.length) {
              setPoints(v.curve.map((p) => [p[0], p[1]]));
              setStatus((prev) => (prev ? { ...prev, curve: v.curve } : prev));
            }
            flash(t("gpuFan.saved"));
          }
        } catch (e) {
          setError(String((e && e.message) || e));
        }
        setBusy(null);
      };

      const applyPin = async () => {
        const pct = Math.round(Number(pinPct));
        setBusy("pin");
        try {
          const r = await remote.setPct(pct);
          const v = r.ok ? r.value : null;
          if (!r.ok || (v && v.ok === false)) {
            setError((r.ok ? v && v.error : r.error) || t("gpuFan.offline"));
          } else {
            flash(`${t("gpuFan.fan", { n: "*" })} ${pct}%`);
          }
        } catch (e) {
          setError(String((e && e.message) || e));
        }
        setBusy(null);
      };

      const goAuto = async () => {
        setBusy("auto");
        try {
          const r = await remote.auto();
          const v = r.ok ? r.value : null;
          if (!r.ok || (v && v.ok === false)) {
            setError((r.ok ? v && v.error : r.error) || t("gpuFan.offline"));
          } else {
            flash(t("gpuFan.mode.auto"));
          }
        } catch (e) {
          setError(String((e && e.message) || e));
        }
        setBusy(null);
      };

      const temp = status && status.ok ? status.temp : null;
      const gpu = status && status.ok && status.gpu ? status.gpu : null;
      const fans = status && status.ok && status.fans ? status.fans : [];
      const daemonMode = status && status.ok && status.daemon ? status.daemon.mode : null;

      const setRowPoint = (i, key, value) =>
        setPoints((prev) => prev.map((p, j) => (j === i ? [key === 0 ? value : p[0], key === 1 ? value : p[1]] : p)));
      const removePoint = (i) => setPoints((prev) => prev.filter((_, j) => j !== i));
      const addPoint = () => setPoints((prev) => (prev ? [...prev, [80, 80]] : DEFAULT_CURVE.map((p) => [p[0], p[1]])));
      const resetCurve = () => setPoints(DEFAULT_CURVE.map((p) => [p[0], p[1]]));

      return React.createElement(
        "div",
        { className: "gpf-page" },
        notice
          ? React.createElement(
              "div",
              { className: "gpf-toast", role: "status" },
              React.createElement("span", null, notice),
              React.createElement("span", { className: "gpf-toastx", onClick: () => setNotice(null), "aria-label": "close" }, "✕")
            )
          : null,
        React.createElement(
          "div",
          { className: "gpf-card" },
          // header
          React.createElement(
            "div",
            { className: "gpf-head" },
            React.createElement("span", { className: "gpf-logo" }, FanIcon({ size: 20 })),
            React.createElement("span", { className: "gpf-title" }, t("gpuFan.title")),
            React.createElement("span", { className: "gpf-live" }, React.createElement("i", null), t("gpuFan.live")),
            gpu && gpu.name ? React.createElement("span", { className: "gpf-chip" }, gpu.name) : null,
            daemonMode !== null
              ? React.createElement("span", { className: "gpf-chip gpf-daemon" }, `${t("gpuFan.daemon")}: ${t("gpuFan.mode." + daemonMode)}`)
              : null
          ),
          error ? React.createElement("div", { className: "gpf-err" }, t("gpuFan.error", { msg: error })) : null,

          // hero: temperature + fans
          React.createElement(
            "div",
            { className: "gpf-sec" },
            React.createElement("h4", null, IcoThermo(), t("gpuFan.tempFans")),
            React.createElement(
              "div",
              { className: "gpf-hero" },
              React.createElement(
                "div",
                { className: "gpf-tempwrap" },
                React.createElement(
                  "div",
                  { className: "gpf-temp", style: { color: tempColor(temp) } },
                  React.createElement("span", { className: "gpf-big" }, temp === null ? "—" : temp),
                  React.createElement("span", { className: "gpf-deg" }, "°C")
                ),
                React.createElement("span", { className: "gpf-templabel" }, t("gpuFan.temp"))
              ),
              React.createElement(
                "div",
                { className: "gpf-fans" },
                fans.length === 0
                  ? React.createElement("span", { className: "gpf-hint" }, "—")
                  : fans.map((f, i) =>
                      React.createElement(
                        "div",
                        { className: "gpf-fanline", key: i },
                        React.createElement(
                          "div",
                          { className: "gpf-fanmeta" },
                          React.createElement("span", null, t("gpuFan.fan", { n: i + 1 })),
                          React.createElement(
                            "span",
                            { className: "gpf-pol " + (f.policy === 1 ? "manual" : "auto") },
                            t(f.policy === 1 ? "gpuFan.policy.manual" : "gpuFan.policy.auto")
                          ),
                          React.createElement(
                            "span",
                            { className: "gpf-fanval" },
                            `${f.cur}%`,
                            React.createElement("span", { className: "gpf-farrow" }, "  →  "),
                            `${f.target}%`
                          )
                        ),
                        React.createElement(
                          "div",
                          { className: "gpf-fanbar" },
                          React.createElement("i", { style: { width: `${clampPct(f.target)}%` } }),
                          React.createElement("em", { style: { left: `calc(${clampPct(f.cur)}% - 1.25px)` } })
                        )
                      )
                    )
              )
            )
          ),

          // device overview
          React.createElement(
            "div",
            { className: "gpf-sec" },
            React.createElement("h4", null, IcoChip(), t("gpuFan.device")),
            React.createElement(
              "div",
              { className: "gpf-grid" },
              React.createElement(StatTile, {
                icon: IcoLayers(),
                label: t("gpuFan.mem"),
                value: gpu && gpu.memTotal ? `${fmtGB(gpu.memUsed)} / ${fmtGB(gpu.memTotal)} GB` : "—",
                pct: gpu && gpu.memTotal ? (gpu.memUsed / gpu.memTotal) * 100 : null,
              }),
              React.createElement(StatTile, {
                icon: IcoPulse(),
                label: t("gpuFan.utilGpu"),
                value: gpu ? `${gpu.utilGpu}%` : "—",
                pct: gpu ? gpu.utilGpu : null,
              }),
              React.createElement(StatTile, {
                icon: IcoLayers(),
                label: t("gpuFan.utilMem"),
                value: gpu ? `${gpu.utilMem}%` : "—",
                pct: gpu ? gpu.utilMem : null,
              }),
              React.createElement(StatTile, {
                icon: IcoBolt(),
                label: t("gpuFan.power"),
                value: gpu && gpu.powerW ? `${Math.round(gpu.powerW)} W` : "—",
                sub: gpu && gpu.powerLimitW ? `/${Math.round(gpu.powerLimitW)} W` : null,
              }),
              React.createElement(StatTile, {
                icon: IcoGauge(),
                label: t("gpuFan.clock"),
                value: gpu && gpu.clockMhz ? `${gpu.clockMhz} MHz` : "—",
                sub: gpu && gpu.memClockMhz ? `${t("gpuFan.memClock")} ${gpu.memClockMhz} MHz` : null,
              }),
              React.createElement(StatTile, {
                icon: IcoTag(),
                label: t("gpuFan.driver"),
                value: gpu && gpu.driver ? gpu.driver : "—",
              })
            )
          ),

          // curve editor
          React.createElement(
            "div",
            { className: "gpf-sec" },
            React.createElement("h4", null, IcoCurve(), t("gpuFan.curve")),
            points === null ? null : React.createElement(CurveChart, { points, temp }),
            points === null ? null : React.createElement(
              "div",
              { className: "gpf-crowlist" },
              points.map((p, i) =>
                React.createElement(
                  "div",
                  { className: "gpf-row", key: i },
                  React.createElement("input", {
                    type: "number", min: 0, max: 120, value: p[0],
                    "aria-label": `${t("gpuFan.temp")} ${i + 1}`,
                    onChange: (e) => setRowPoint(i, 0, Number(e.target.value)),
                  }),
                  React.createElement("span", { className: "gpf-unit" }, "°C"),
                  React.createElement("span", { className: "gpf-arrow" }, "→"),
                  React.createElement("input", {
                    type: "number", min: 30, max: 100, value: p[1],
                    "aria-label": `% ${i + 1}`,
                    onChange: (e) => setRowPoint(i, 1, Number(e.target.value)),
                  }),
                  React.createElement("span", { className: "gpf-unit" }, "%"),
                  React.createElement("button", { className: "gpf-x", title: t("gpuFan.removePoint"), onClick: () => removePoint(i) }, "×")
                )
              )
            ),
            React.createElement(
              "div",
              { className: "gpf-row" },
              React.createElement("button", { className: "gpf-btn", onClick: addPoint }, t("gpuFan.addPoint")),
              React.createElement("button", { className: "gpf-btn", onClick: resetCurve }, t("gpuFan.defaultCurve")),
              React.createElement("button", { className: "gpf-btn primary", disabled: busy === "save" || points === null, onClick: saveCurve }, t("gpuFan.saveCurve")),
              React.createElement("div", { className: "gpf-hint", style: { marginLeft: "auto" } }, t("gpuFan.hint"))
            )
          ),

          // quick actions
          React.createElement(
            "div",
            { className: "gpf-sec" },
            React.createElement("h4", null, IcoZap(), t("gpuFan.quick")),
            React.createElement(
              "div",
              { className: "gpf-row" },
              React.createElement("input", {
                type: "range", min: 30, max: 100, value: pinPct,
                className: "gpf-range",
                "aria-label": t("gpuFan.quick"),
                onChange: (e) => setPinPct(Number(e.target.value)),
              }),
              React.createElement("span", { className: "gpf-pintval" }, `${pinPct}%`),
              React.createElement("div", { style: { flex: 1 } }),
              React.createElement("button", { className: "gpf-btn primary", disabled: busy === "pin", onClick: applyPin }, t("gpuFan.applyNow")),
              React.createElement("button", { className: "gpf-btn", disabled: busy === "auto", onClick: goAuto }, t("gpuFan.auto"))
            )
          )
        )
      );
    }
    const inject = ["slots", "locale", "remote"];

    async function apply(ctx) {
      const disposers = [];
      try {
        dbg("apply");
        disposers.push(await ctx.remote.$mount(TYPERT_REMOTE));
        const nsEntry = ctx.remote.namespaces.get("gpuFan");
        const api = nsEntry ? nsEntry.service : undefined;
        if (api === undefined) throw new Error("gpuFan namespace missing after $mount");
        dbg("mount");
        disposers.push(ctx.effect(() => ctx.locale.register(NS, dictionaries), "@local/dsh-gpu-fan: locale"));
        dbg("locale");
        const t = ctx.locale.bind(NS);
        disposers.push(
          ctx.slots.inject("sidebar.panellist", () =>
            ctx.slots.register(
              {
                name: "sidebar.panellist",
                id: "gpuFan",
                order: 5,
                label: () => t("panel"),
                locale: NS,
              },
              GpuFanPanelIcon
            )
          )
        );
        disposers.push(
          ctx.slots.inject("main", () =>
            ctx.slots.register(
              {
                name: "main",
                key: "gpuFan",
                locale: NS,
                inject: () => ({ t, api }),
              },
              GpuFanPage
            )
          )
        );
        dbg("slots");
      } catch (e) {
        dbg("apply_error", e && (e.stack || e.message) ? String(e.stack || e.message) : String(e));
        for (const d of disposers.splice(0)) { try { d(); } catch (ignored) {} }
        throw e;
      }
      return () => {
        for (const d of disposers.splice(0)) { try { d(); } catch (ignored) {} }
      };
    }

    return { inject, apply };
  },
});
