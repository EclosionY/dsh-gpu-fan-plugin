# dsh-gpu-fan

本地 DSH 插件：在 Web GUI 的 composer 区提供 RTX 3080 风扇实时面板。

## 功能
- composer 工具栏的圆角 pill：实时显示 GPU 温度与 0 号风扇目标转速（2s 轮询）。
- 点击 pill 展开面板：
  - 温度 + 双风扇 当前%/目标%/策略
  - 温度→转速% 曲线编辑器（增/删/改点、保存；守护进程 ~2s 热加载生效）
  - 立即固定转速（30–100%）与恢复自动模式
- 驱动下限 30%（RTX 3080 硬件限制，低于 30 会被钳回 30）。

## 依赖（本机）
- 风扇守护：`/opt/nvfan/nvfan`（systemd `nvfan.service`，配置 `/etc/nvfan.conf`）
- Host 侧：`status` 直接执行 nvfan（只读）；`setCurve`/`setPct`/`auto` 通过
  `sudo -n /opt/nvfan/nvfan`（`/etc/sudoers.d/nvfan` 已为 Harness 用户配置 NOPASSWD）。
- Host 依赖：`@deepseek-ai/dsh-typert-protocol`（remote 方法标记）。

## Remote API（namespace `gpuFan`）
| 方法 | 参数 | 返回 |
|---|---|---|
| `status` | — | `{ok, temp, fans:[{name,cur,target,policy}], curve, daemon}` |
| `setCurve(points)` | `points: [[temp,pct],...]` | `{ok, curve}` |
| `setPct(pct)` | `pct: int 30-100` | `{ok, pct}` |
| `auto` | — | `{ok}` |

失败时返回 `{ok:false, error}`。

## 文件
- `index.js` — Host service（GpuFan，TypertRemoteService）
- `client.js` — Web 客户端（composer.dock pill + 面板；内联 typert remote-info 帮助器）
- `cordis.patch.yml` — host 图插入行
- `locale/*.json` — 插件目录元信息
- `icon.svg`

## 注意
- 第二风扇（fan1）实时转速 NVML 读不出（恒 0），目标值与温度响应正常。
- 曲线热加载：守护进程每次轮询重读 /etc/nvfan.conf，保存后 ~2s 生效。
