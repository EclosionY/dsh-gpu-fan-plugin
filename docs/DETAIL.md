# dsh-gpu-fan

本地 DSH 插件：在 Web GUI 中提供 **NVIDIA 显卡风扇实时控制面板**。插件代码不写死显卡型号，兼容各型号 NVIDIA 显卡，通过 NVML 驱动风扇、由本机 `nvfan` 守护进程执行实际控制。

## 界面位置

插件注册两个界面入口：

- **左侧边栏条目**（`sidebar.panellist` 插槽，id `gpuFan`，order 5）：风扇图标 + 文案「GPU 风扇」（英文「GPU Fan」）。点击后进入完整控制页面。
- **主区域页面**（`main` 插槽，key `gpuFan`）：选中侧边栏条目后在主区域展示的完整面板。

页面每 **2 秒**轮询一次 `status`，实时刷新。

## 面板内容

- **头部**：标题、实时（LIVE）指示、显卡型号标签、守护进程当前模式（曲线 / 手动 / 自动）。
- **温度与风扇**：
  - 大号温度读数（按温度分档变色：低温绿 / 中温橙 / 高温红）。
  - 每个风扇一行，显示**当前转速 → 目标转速**、策略（自动 / 手动）与进度条。
- **设备概览**：设备、显存、GPU 利用率、显存利用率、功耗、核心频率、显存频率、驱动版本。
- **温度曲线**：
  - 温度 °C → 转速 % 的 SVG 曲线图，带当前温度标记。
  - 控制点编辑：每个点可改温度与转速，可删除；支持「＋ 加点」「恢复默认」「保存曲线」。
  - 保存后写入守护进程配置并热加载，约 2 秒内生效。
- **快速操作**：输入转速值（30–100）点「立即生效」，把双风扇钉在该转速；或点「恢复自动」交还驱动自动控制。

> 驱动对转速有下限约束：低于 30% 会被钳回 30%，故可设置范围为 30–100%。

## 依赖（本机）

- 风扇守护：`/opt/nvfan/nvfan`（systemd `nvfan.service`，配置 `/etc/nvfan.conf`）。
- Host 侧：`status` 直接执行 nvfan（只读）；`setCurve` / `setPct` / `auto` 通过
  `sudo -n /opt/nvfan/nvfan` 调用（`/etc/sudoers.d/nvfan` 需为运行 DSH 的用户配置 NOPASSWD）。
- Host 依赖：`@deepseek-ai/dsh-typert-protocol`（remote 方法标记）。
- 运行环境：Linux + NVIDIA 驱动，具备可用 NVML 接口。

## Remote API（namespace `gpuFan`）

| 方法 | 参数 | 返回 |
|---|---|---|
| `status` | — | `{ok, temp, gpu, fans:[{name,cur,target,policy}], curve, daemon}` |
| `setCurve(points)` | `points: [[temp,pct],...]`（2–32 个点） | `{ok, curve}` |
| `setPct(pct)` | `pct: int 30-100` | `{ok, pct}` |
| `auto` | — | `{ok}` |

失败时返回 `{ok:false, error}`。`status` 为只读；其余为写操作，经免密 `sudo -n` 调用守护进程。

## 文件

- `index.js` — Host service（`GpuFan`，TypertRemoteService）。
- `client.js` — Web 客户端（侧边栏条目 + 完整面板；内联 typert remote-info 帮助器）。
- `cordis.patch.yml` — Host 图插入行（id `dsh-gpu-fan`，包名 `@local/dsh-gpu-fan`）。
- `locale/*.json` — 插件目录元信息与界面文案。
- `icon.svg`、`screenshot.png` — 图标与界面截图。

## 注意 / 限制

- **第二风扇（fan1）实时转速 NVML 读不出**（恒为 0），目标值与温度响应正常。
- **曲线热加载**：守护进程每次轮询重读 `/etc/nvfan.conf`，保存后约 2 秒生效，无需重启。
- **需要免密 sudo**：未正确配置时，保存曲线 / 钉转速 / 恢复自动会失败。
- **依赖本机守护进程**：插件本身不直接操作硬件，缺少 `nvfan` 守护时面板可打开但控制不可用。
