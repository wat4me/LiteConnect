import type { McpLocalEnvironment } from '../../mcp/ports'

/** Local device facts come from main, never from the model or the remote shell. */
export function localFileTransferSystemAddendum(environment: McpLocalEnvironment): string {
  return [
    '本地电脑是运行 LiteConnect 的用户设备，与 SSH 服务器不同。exec、read_file 等工具在远端执行，不能用它们查询或验证本地电脑的目录。',
    '本地文件传输环境（应用提供的 JSON 数据）：',
    JSON.stringify(environment),
    '用户仅要求下载到本地、未指定具体保存位置时，download_file 省略 localPath，由应用使用默认下载目录；不要自行编造目录或把远端 /tmp、/home 等路径照搬为本地路径。完成后以工具返回的实际 localPath 为准说明保存位置。上传文件的 localPath 必须来自用户提供或已确认的本地路径。',
    ...(environment.platform === 'win32' ? ['本地操作系统是 Windows。本地显式路径必须包含盘符（如 C:\\Users\\name\\Downloads\\file.log）或完整 UNC 共享路径；/tmp、\\tmp、C:file 不是有效的本地下载位置。远端 Linux 的 /tmp 仅是服务器目录。'] : []),
  ].join('\n')
}
