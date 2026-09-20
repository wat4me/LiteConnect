export default {
  settingsHostKeys: {
    title: '主机信任',
    intro: '管理首次连接 SSH 主机时确认并保存的服务器指纹。',
    trusted: '已信任的主机',
    hint: '指纹用于确认你连接的是同一台服务器。只有在服务器重装、密钥更换或记录有误时才应删除。',
    empty: '暂无已信任的主机',
    firstSeen: '首次信任：{time}',
    removeTitle: '删除主机信任？',
    removeMessage: '将删除 {host}:{port} 的已信任指纹。下次连接时需要重新确认服务器身份。',
    removed: '已删除该主机的信任记录',
    loadFailed: '无法读取主机信任记录',
    removeFailed: '删除失败',
  },
} as const
