# @local/dsh-gpu-fan

> DSH 插件：NVIDIA 显卡风扇实时控制面板。提供温度 / 转速实时显示、温度→转速曲线编辑器，以及固定 / 自动模式切换，通过 NVML 驱动风扇，曲线保存后热加载即时生效。

English summary: A DeepSeek Harness (DSH) plugin that adds a real-time NVIDIA GPU fan control panel — live temperature and fan readings, a temperature-to-fan-speed curve editor, and manual/auto switching — driven through NVML with hot-reloaded curves.

## 功能概览

插件在 DSH 的 Web GUI 中新增一个 **「GPU 风扇」** 面板，无需打开外部工具即可实时查看并调节显卡风扇。

- **实时监测**：GPU 温度、显存占用、GPU / 显存利用率、功耗、核心 / 显存频率、驱动版本，2 秒轮询刷新。
- **风扇状态**：逐风扇显示当前转速、目标转速与控制策略（自动 / 手动）。
- **温度曲线编辑器**：以「温度 °C → 转速 %」为坐标，支持添加、删除、修改控制点；保存后写入守护进程配置并热加载，约 2 秒内生效。
- **快速操作**：一键把双风扇钉到固定转速（30–100%），或一键交还驱动自动控制。
- **守护进程状态**：显示 `nvfan` 守护的运行状态与当前模式（曲线 / 手动 / 自动）。

插件代码不写死具体显卡型号，**兼容各型号 NVIDIA 显卡**；只要本机 `nvfan` 守护进程能通过 NVML 控制该卡风扇即可使用（已在 RTX 3080 上验证）。

## 安装

### 前置依赖

- **Host 侧**：本机需存在风扇守护进程 `nvfan`（默认路径 `/opt/nvfan/nvfan`），配置文件 `/etc/nvfan.conf`。
- **写操作授权**：`setCurve` / `setPct` / `auto` 通过 `sudo -n /opt/nvfan/nvfan` 调用守护进程。需为运行 DSH 的用户配置免密 sudo，例如 `/etc/sudoers.d/nvfan` 中加入：

  ```
  <运行用户> ALL=(root) NOPASSWD: /opt/nvfan/nvfan
  ```

- **Host 依赖**：`@deepseek-ai/dsh-typert-protocol`（用于 remote 方法标记，插件内联了同源协议实现）。
- **Linux + NVIDIA 驱动**：需具备可用的 NVML 接口。

### 安装方式

将本目录作为本地插件目录安装：

1. 在 DSH 中进入 **Plugins → Add plugin**，选择本目录（本地目录安装会直接链接该检出）。
2. 或在 profile 中通过 `plugin_manager` 的 `install_bundle` 安装本包目录。

插件通过 `cordis.patch.yml` 插入 Host 图行，行 id 为 `dsh-gpu-fan`，包名为 `@local/dsh-gpu-fan`。安装后在 **Plugins** 中启用即可。

## 使用说明

启用插件后：

1. 在左侧边栏找到 **「GPU 风扇」** 条目并点击，进入完整控制页面。
2. **实时区**：查看显卡各项指标与风扇当前 / 目标转速、策略。
3. **温度曲线**：
   - 点击 **「＋ 加点」** 添加控制点；在输入框中调整该点的「温度」与「转速」。
   - 点 **「×」** 删除该点，点 **「恢复默认」** 回到默认曲线。
   - 编辑完成后点击 **「保存曲线」**，守护进程约 2 秒内热加载生效。
4. **快速操作**：
   - 输入转速值（30–100）后点 **「立即生效」**，把双风扇钉在该转速。
   - 点 **「恢复自动」**，把风扇控制交还驱动自动控制。

> 驱动对转速有下限约束：低于 30% 会被钳回 30%，故可设置范围为 30–100%。

## Remote API

Host 侧以 namespace `gpuFan` 暴露远程方法，Client 通过 typert remote 绑定调用：

| 方法 | 参数 | 返回 |
|---|---|---|
| `status` | — | `{ ok, temp, fans: [{ name, cur, target, policy }], gpu, curve, daemon }` |
| `setCurve(points)` | `points: [[temp, pct], ...]`，2–32 个点 | `{ ok, curve }` |
| `setPct(pct)` | `pct: int 30–100` | `{ ok, pct }` |
| `auto` | — | `{ ok }` |

- `status` 为只读操作，直接执行 `nvfan status`。
- `setCurve` / `setPct` / `auto` 会以 `sudo -n` 调用 `nvfan` 修改配置，失败时返回 `{ ok: false, error }`。
- 曲线保存后，守护进程在下一个轮询周期重读 `/etc/nvfan.conf`，约 2 秒内生效。

## 配置

插件当前不暴露自定义配置字段，依赖项为固定的：

| 项 | 值 | 说明 |
|---|---|---|
| `nvfan` 二进制 | `/opt/nvfan/nvfan` | 风扇守护进程 |
| `nvfan` 配置 | `/etc/nvfan.conf` | 温度曲线与模式，热加载 |
| sudo | 需免密执行 `nvfan` | 写操作所需 |
| 转速下限 | `30%` | 驱动硬件限制 |
| 转速上限 | `100%` | — |
| 曲线点数 | `2–32` | 温度 0–120 °C |

## 工作原理

- **Host 侧**（`index.js`）：`GpuFan` 是一个 `TypertRemoteService`，封装对 `nvfan` 守护进程的调用。`status` 解析守护返回的 JSON，汇总温度、风扇、显存、功耗、频率等信息；`setCurve` / `setPct` / `auto` 组装命令并执行。remote 方法通过内联的 typert 协议描述符标记。
- **Client 侧**（`client.js`）：通过 `window.__ModuleLoader__` 加载，注入 `slots`、`locale`、`remote`，挂载两个界面：
  - `sidebar.panellist` 插槽中的侧边栏条目（id `gpuFan`，order 5）；
  - `main` 插槽中 key 为 `gpuFan` 的完整页面。
- **曲线热加载**：保存曲线写入 `/etc/nvfan.conf`，守护进程每次轮询重读该文件，无需重启即可生效。

## 文件结构

| 文件 | 说明 |
|---|---|
| `index.js` | Host 服务（`GpuFan`，TypertRemoteService） |
| `client.js` | Web 客户端（侧边栏条目 + 完整面板，内联 typert remote-info 帮助器） |
| `cordis.patch.yml` | Host 图插入行（`dsh-gpu-fan`） |
| `locale/*.json` | 插件元信息与界面文案（8 种语言：`en` / `zh` / `de` / `es` / `fr` / `ja` / `pt` / `ru`） |
| `docs/DETAIL.md` | 插件详情页文档 |
| `icon.svg` | 插件图标 |
| `package.json` | 包清单，声明 `dsh.bundle.patch` 与 `dsh.client` |
| `screenshot.png` | 界面截图 |

## 已知限制

- **第二风扇实时转速读不出**：部分型号的 `fan1` 当前转速经 NVML 读取恒为 0，目标值与温度响应正常，仅当前值显示为 0。
- **依赖本机守护进程**：插件本身不直接操作硬件，需本机存在可用的 `nvfan` 守护进程；无该依赖的机器上面板可打开但控制不可用。
- **转速下限**：受驱动约束，转速不可低于 30%。
- **需要免密 sudo**：写操作依赖 `sudo -n`，未正确配置时保存 / 钉转速 / 恢复自动会失败。
- **曲线点数范围**：每个曲线需 2–32 个不同温度点，超出会被拒绝。

## 开发

- 本地安装：在 **Plugins → Add plugin** 中选择本目录，或用 `plugin_manager` 的 `install_bundle` 安装。
- 修改后提交并推送，重新安装 / 更新本目录即可生效；替换已安装包通常需要重启以加载新的模块。

## 许可证

[Apache-2.0](LICENSE)
