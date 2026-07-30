/**
 * Demo sessions aligned with real SSH host groups (TabBar) + one DB mode view.
 * Names/IPs are fictional placeholders for the product site — not real hosts.
 */
window.DEMO = {
  /** SSH host groups — appear in TabBar */
  hosts: [
    {
      id: 'prod-web',
      name: 'prod-web',
      titlebar: 'prod-web · root@web.demo.local:22',
      latency: 18,
      sessionCount: 2,
      tool: 'ai',
      monitor: true,
      subTabs: [
        { id: '1', n: 1, active: true },
        { id: '2', n: 2, active: false },
      ],
      terminal: [
        { cls: 'dim', text: 'Last login: Mon Jul 28 09:12:04 2026 from bastion.demo.local' },
        { cls: '', text: '' },
        { prompt: 'root@prod-web:/var/www/html# ', cmd: 'systemctl status nginx --no-pager' },
        { cls: 'ok', text: '● nginx.service - A high performance web server and a reverse proxy server' },
        { cls: 'dim', text: '     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)' },
        { cls: 'ok', text: '     Active: active (running) since Mon 2026-07-28 09:12:11 UTC; 2h ago' },
        { cls: 'dim', text: '   Main PID: 1421 (nginx)' },
        { cls: '', text: '' },
        { prompt: 'root@prod-web:/var/www/html# ', cmd: 'ss -lntp | grep :80' },
        { cls: '', text: 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1421,fd=6))' },
        { cls: '', text: '' },
        { prompt: 'root@prod-web:/var/www/html# ', cmd: 'tail -n 3 /var/log/nginx/access.log' },
        { cls: 'dim', text: '203.0.113.10 - - [28/Jul/2026:11:02:01] "GET /health 200" 1.2ms' },
        { cls: 'dim', text: '203.0.113.12 - - [28/Jul/2026:11:02:08] "GET /api/orders 200" 18ms' },
        { cls: 'warn', text: '203.0.113.15 - - [28/Jul/2026:11:02:11] "POST /api/checkout 201" 41ms' },
        { cls: '', text: '' },
        { prompt: 'root@prod-web:/var/www/html# ', cmd: '', cursor: true },
      ],
      ai: {
        messages: [
          {
            role: 'user',
            meta: '你 · 来自终端选区',
            body: 'nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)',
          },
          {
            role: 'assistant',
            meta: 'AI',
            body:
              '80 端口已被占用。建议：\n\n1. `ss -lntp | grep :80` 查看占用进程\n2. 确认是否已有 nginx / 其它 Web 服务\n3. 停掉冲突进程或改端口后 `systemctl reload nginx`\n\n当前会话里 nginx 已在监听 80，这次 emerg 多半是重复启动。',
          },
        ],
      },
      monitorMetrics: {
        host: 'prod-web',
        cpu: 23,
        mem: 53,
        disk: 56,
        load: '0.42',
      },
    },
    {
      id: 'staging',
      name: 'staging',
      titlebar: 'staging · deploy@stg.demo.local:22',
      latency: 42,
      sessionCount: 1,
      tool: 'sftp',
      monitor: false,
      subTabs: [{ id: '1', n: 1, active: true }],
      terminal: [
        { prompt: 'deploy@staging:~/app$ ', cmd: 'git status -sb' },
        { cls: '', text: '## release/1.0.2...origin/release/1.0.2' },
        { cls: 'warn', text: ' M config/production.yml' },
        { cls: 'ok', text: '?? scripts/healthcheck.sh' },
        { cls: '', text: '' },
        { prompt: 'deploy@staging:~/app$ ', cmd: 'ls -lah dist/ | head -n 5' },
        { cls: 'dim', text: 'total 12M' },
        { cls: '', text: 'drwxr-xr-x  5 deploy deploy 4.0K Jul 28 10:41 .' },
        { cls: '', text: '-rw-r--r--  1 deploy deploy 2.1M Jul 28 10:41 app.js' },
        { cls: '', text: '' },
        { prompt: 'deploy@staging:~/app$ ', cmd: 'df -h /' },
        { cls: '', text: 'Filesystem  Size  Used Avail Use% Mounted on' },
        { cls: 'warn', text: '/dev/vda1    40G   31G  7.2G  82% /' },
        { cls: '', text: '' },
        { prompt: 'deploy@staging:~/app$ ', cmd: '', cursor: true },
      ],
      sftp: {
        path: '/home/deploy/app',
        entries: [
          { kind: 'dir', name: 'config', size: '—' },
          { kind: 'dir', name: 'dist', size: '—' },
          { kind: 'dir', name: 'scripts', size: '—' },
          { kind: 'file', name: 'package.json', size: '2.4 KB' },
          { kind: 'file', name: 'README.md', size: '6.1 KB' },
          { kind: 'file', name: '.env.example', size: '812 B' },
        ],
        transfers: [
          { name: 'dist/app.js', state: '完成' },
          { name: 'config/production.yml', state: '完成' },
        ],
      },
    },
  ],

  /**
   * Docker workspace demo data — shown when user toggles Docker on the current SSH session
   * (mirrors real app: Docker replaces terminal content in the active host, not a separate tab).
   */
  dockerView: {
    engine: '26.1.4',
    api: '1.45',
    filter: 'all',
    counts: { all: 10, running: 8, stopped: 2 },
    containers: [
      {
        id: 'c1',
        name: 'api-gateway-blue',
        image: 'registry.demo.local/api-gateway:1.8',
        state: 'running',
        ports: '8080→80/tcp, 8443→443/tcp',
        status: 'Up 19 hours',
        action: '停止',
        active: false,
      },
      {
        id: 'c2',
        name: 'api-gateway-green',
        image: 'registry.demo.local/api-gateway:1.8',
        state: 'running',
        ports: '9080→80/tcp, 9443→443/tcp',
        status: 'Up 19 hours',
        action: '停止',
        active: true,
        fullName: 'api-gateway-green',
        fullImage: 'registry.demo.local/api-gateway:1.8.2',
        fullId: '5c529973f936fdb436a5f7f325fe6e08a7a32d4f6196bde2ac559548d8963931',
        created: '2026/7/27 21:20:52',
        started: '2026/7/27 21:20:52',
        restartPolicy: 'unless-stopped',
        network: 'bridge',
        portChips: ['22/tcp', '80/tcp', '443/tcp', '9080→80/tcp', '9443→443/tcp'],
        mounts: [
          '/data/app/logs → /var/log/app',
          '/data/app/config → /etc/app',
          '/data/shared/cache → /var/cache/app',
          '/data/shared/uploads → /var/www/uploads',
        ],
      },
      {
        id: 'c3',
        name: 'worker-jobs',
        image: 'registry.demo.local/worker:2.1',
        state: 'running',
        ports: '无端口',
        status: 'Up 19 hours',
        action: '停止',
        active: false,
      },
      {
        id: 'c4',
        name: 'redis-cache',
        image: 'redis:7.2-alpine',
        state: 'running',
        ports: '6379→6379/tcp',
        status: 'Up 3 days',
        action: '停止',
        active: false,
      },
      {
        id: 'c5',
        name: 'postgres-primary',
        image: 'postgres:16-alpine',
        state: 'running',
        ports: '5432→5432/tcp',
        status: 'Up 3 days',
        action: '停止',
        active: false,
      },
      {
        id: 'c6',
        name: 'nginx-edge',
        image: 'nginx:1.27',
        state: 'running',
        ports: '80→80/tcp, 443→443/tcp',
        status: 'Up 3 days',
        action: '停止',
        active: false,
      },
      {
        id: 'c7',
        name: 'metrics-agent',
        image: 'registry.demo.local/metrics-agent:0.9',
        state: 'running',
        ports: '9100→9100/tcp',
        status: 'Up 3 days',
        action: '停止',
        active: false,
      },
      {
        id: 'c8',
        name: 'mail-relay',
        image: 'registry.demo.local/mail-relay:1.2',
        state: 'running',
        ports: '25→25/tcp, 587→587/tcp',
        status: 'Up 8 days',
        action: '停止',
        active: false,
      },
      {
        id: 'c9',
        name: 'batch-exporter',
        image: 'registry.demo.local/batch-runner:1.0',
        state: 'exited',
        ports: '无端口',
        status: 'Exited (0) 2 weeks ago',
        action: '启动',
        active: false,
      },
      {
        id: 'c10',
        name: 'legacy-mysql',
        image: 'mysql:8.0',
        state: 'exited',
        ports: '3306→3306/tcp',
        status: 'Exited (255) 2 weeks ago',
        action: '启动',
        active: false,
      },
    ],
  },

  /**
   * Database module — structure mirrors DatabaseView.vue
   * (bk-root → bk-workspace → topbar + sidebar + editor + statusbar)
   */
  database: {
    titlebar: 'app@db.demo.local:3306',
    engine: 'mysql',
    connName: 'shop-mysql',
    meta: 'app@db.demo.local:3306',
    connections: [
      { name: 'analytics-pg:5432', live: false, expanded: false, dbs: [] },
      {
        name: 'shop-mysql:3306',
        live: true,
        expanded: true,
        active: true,
        dbs: ['shop', 'inventory', 'billing', 'reports', 'audit_log', 'sandbox'],
      },
      { name: 'legacy-ora:1521', live: false, expanded: false, dbs: [] },
    ],
    tabTitle: '查询 1',
    tabConn: 'shop-mysql',
    defaultDb: 'shop',
    sql: `-- 在此输入 SQL；有选区时默认运行所选，否则运行光标处当前语句
SELECT id, name, status, updated_at
FROM shop.orders
WHERE status = 'paid'
ORDER BY updated_at DESC
LIMIT 50;`,
    editorStatus: '1:1',
    runScope: '全部',
    footer: 'MySQL · shop-mysql · 已连接',
    outputTab: 'result',
    columns: ['id', 'name', 'status', 'updated_at'],
    rows: [
      ['1001', 'nightly-sync', 'paid', '2026-07-28 10:12:01'],
      ['1000', 'health-check', 'paid', '2026-07-28 09:48:22'],
      ['998', 'export-report', 'paid', '2026-07-27 22:01:44'],
    ],
    history: [
      { time: '07-28 11:28', ms: '25ms', rows: '1 rows', ok: true },
      { time: '07-28 10:50', ms: '91ms', rows: '12 rows', ok: true },
      { time: '07-27 14:48', ms: '33ms', rows: '—', ok: false },
    ],
  },
}
