export type ConnectionFormModel = {
  name: string
  host: string
  port: number
  username: string
  password: string
  privateKey: string
  group: string | undefined
  note: string
  colorTag: string
  keepaliveInterval: number
  x11Forwarding: boolean
  x11Host: string
  x11Display: number
  jumpHost: string
  jumpPort: number
  jumpUsername: string
  jumpPassword: string
  jumpPrivateKey: string
  useAgent: boolean
  localForwards: Array<{ localPort: number; remoteHost: string; remotePort: number }>
  remoteForwards: Array<{ remoteHost: string; remotePort: number; localHost: string; localPort: number }>
  dynamicForwards: Array<{ localPort: number }>
}

export type ConnectionFormSection = 'basic' | 'tunnel' | 'advanced'
