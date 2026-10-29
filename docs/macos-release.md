# macOS 签名与公证发布

当前基础打包配置为未签名模式。下载后的应用可能被 Gatekeeper 拦截，显示“已损坏，无法打开”等提示。清除隔离属性后能启动，说明这次问题与下载后的安全检查有关，不能据此证明安装包的签名有效。

正式分发使用 **Developer ID Application 签名 → Apple 公证 → 附加公证票据 → 打包及验证**，不需要上架 App Store。接入需要有效的 Apple Developer Program 会员及以下凭据。

## 1. 确认证书与私钥

在保存开发证书的 Mac 上执行只读检查：

```bash
security find-identity -v -p codesigning
```

查找 `Developer ID Application: 姓名或组织 (TEAMID)`。打开“钥匙串访问 → 我的证书”，展开这张证书，确认下面有对应的**私钥**。

- 有证书及私钥：将它们一起导出为 `.p12`，设置导出密码。
- 只有 `.cer`：需要找到生成证书请求的 Mac 上的私钥，或重新签发。
- 没有证书：由有权限的账号按 [Apple 的 Developer ID 证书说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) 创建 **Developer ID Application** 证书。

这里使用应用分发证书；`Apple Development` 和 `Developer ID Installer` 不适用于当前应用包签名。Team ID 是开发者团队的 10 位标识，可以在开发者账号会员信息中查看。

## 2. 准备 Apple 公证凭据

使用 App Store Connect 的 **Team API Key**：保存下载的 `.p8` 私钥、Key ID、Issuer ID，并确保它有公证所需的权限。当前 electron-builder 25 集成使用带 Issuer ID 的团队密钥。申请步骤见 [Electron notarize 的 API Key 说明](https://github.com/electron/notarize#app-store-connect-api-key)。

证书、私钥、密码只保存在受控位置和 GitHub Actions Secrets；不要提交进仓库或发到聊天里。

## 3. 配置 GitHub Actions

在仓库 **Settings → Secrets and variables → Actions → Secrets** 添加：

| Secret | 内容 |
|---|---|
| `MACOS_CERTIFICATE_P12` | `.p12` 文件的 Base64 内容 |
| `MACOS_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_TEAM_ID` | 10 位 Team ID，须与证书一致 |
| `APPLE_API_KEY_BASE64` | App Store Connect `.p8` 文件的 Base64 内容 |
| `APPLE_API_KEY_ID` | 对应的 Key ID |
| `APPLE_API_ISSUER` | 对应的 Issuer ID |

Mac 上可以直接把编码结果放进剪贴板，再粘贴到对应 Secret：

```bash
base64 -i "/path/to/DeveloperID.p12" | pbcopy
base64 -i "/path/to/AuthKey.p8" | pbcopy
```

分别执行并保存两个 Secret。Base64 只是编码，不是加密。

在 **Variables** 添加仓库变量 `MACOS_SIGNING_ENABLED`，值为 `true`。证书未准备好时先不配置这些凭据和开关；旧的未签名构建方式仍可使用。有凭据但开关未启用、开关拼错、凭据缺失，都会报错停止，避免误发未签名包。

首次验证建议手动运行 **Release** 工作流：只生成 Actions 构建产物，不创建公开 Release。凭据配置完成不代表历史版本已修复；需要重新构建后发布新版本。

## 4. 流程及验收

macOS 构建调用 `node scripts/package-macos.cjs`；本机默认 `npm run electron:build` 仍沿用未签名基础配置。

启用签名后，脚本强制选择指定团队的 Developer ID Application 证书，启用 Hardened Runtime，调用 electron-builder 自带的 Apple 公证流程，并给应用附加票据。`.p8` 会临时写入私有目录，在正常结束或异常退出时清理；强制结束进程时由临时构建机回收。证书由 electron-builder 导入临时钥匙串。

打包完成后，分别挂载最终 DMG、解压最终 ZIP，对其中的 `LiteConnect.app` 检查：

- `codesign --verify --deep --strict`：签名与嵌套代码完整性。
- `codesign --display`：Developer ID Application 证书及预期 Team ID。
- `xcrun stapler validate`：公证票据。
- `spctl --assess --type execute`：Gatekeeper 评估。

任意一项失败都会停止上传和后续公开发布。验证不会清除隔离属性或关闭 Gatekeeper。DMG 先卸载再清理临时目录；卸载失败会保留目录。

当前 Windows 开发环境可运行配置和失败路径测试，无法实际执行 Apple 签名、公证与 Mac 首次启动验证。首次成功构建后，还应在 Mac 上通过浏览器重新下载安装包、拖入“应用程序”，在未执行 `xattr` 的情况下验证：启动、SSH、数据库原生驱动、X11。正常的首次“从互联网下载，是否打开”提示仍可能出现，见 [Apple Gatekeeper 说明](https://support.apple.com/zh-cn/102445)。

## 现有未签名版本的临时处理

仅限确认来自本项目可信发布渠道且未被改动的安装包，先拖入“应用程序”，再针对这一应用移除下载隔离属性：

```bash
xattr -dr com.apple.quarantine "/Applications/LiteConnect.app"
open "/Applications/LiteConnect.app"
```

这只是单台 Mac 的临时处理，不会修复安装包签名或替代正式公证。
