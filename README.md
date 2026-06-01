# 太乙金华 · 晶格罗盘 — Vercel 部署

一个融合 格里贝格「晶格论 / 转移电位」与《太乙金华宗旨》回光 的
类 Randonautica 现实坐标探索应用。用**真量子随机**生成点云。

## 为什么用 Vercel

- `api/quantum.js` 是一个**服务端函数**：由服务器去取量子随机（服务器到服务器，
  没有浏览器跨域 CORS 问题），所以量子源能稳定取到。
- 前端只调用同源的 `/api/quantum`，永远不会被 CORS 拦截。
- Vercel 提供 HTTPS，所以浏览器**定位（geolocation）能真正使用**。
- 想用需要 key 的量子源（如 ANU）时，key 放在环境变量里，不暴露给前端。

## 目录结构

```
taiyi-lattice/
├─ api/quantum.js        # 服务端：取量子随机（lfdr.de 免 key；ANU 可选）
├─ src/
│  ├─ main.jsx           # React 挂载入口
│  └─ TaiyiLattice.jsx   # 主组件
├─ index.html
├─ package.json
└─ vite.config.js
```

## 一、最省事：GitHub + Vercel 面板

1. 把这个文件夹推到一个 GitHub 仓库。
2. 打开 https://vercel.com → New Project → 选这个仓库。
3. Framework 选 **Vite**（一般会自动识别），其余默认，点 **Deploy**。
4. 完成后会给你一个 `https://xxx.vercel.app` 网址，手机打开即可用。

`api/` 目录会被 Vercel 自动识别为 Serverless Function，无需额外配置。

## 二、用命令行（Vercel CLI）

```bash
npm i -g vercel        # 安装一次
cd taiyi-lattice
npm install
vercel                 # 首次部署（按提示登录、选项默认回车）
vercel --prod          # 发布到正式域名
```

本地联调（同时跑前端和 /api 函数）：

```bash
vercel dev
```

> 注意：直接 `npm run dev`（纯 Vite）不会启动 `/api` 函数，
> 量子取数会失败并自动回退到 crypto。要测量子源请用 `vercel dev` 或部署后测试。

## 三、（可选）启用 ANU 量子源

默认用免 key 的 lfdr.de 光量子源即可。若想用澳大利亚国立大学 ANU：

1. 去 https://quantumnumbers.anu.edu.au 免费注册拿一个 API key。
2. Vercel 项目 → Settings → Environment Variables 添加：
   - Name：`ANU_API_KEY`
   - Value：你的 key
3. 重新部署。`api/quantum.js` 会优先用 ANU，失败再退回 lfdr.de。

## 熵源说明

撒点前会向 `/api/quantum` 取一段量子熵作种子，再展开成 9000 个点云坐标
（与 Randonautica 取 ANU 量子源同理）。结果卡片底部会标明本次实际用的熵源：

- 青色：量子真随机（lfdr.de 或 ANU）
- 紫色：量子源不可用，已回退到 `crypto.getRandomValues`（硬件熵，非量子）

## 声明

纯属娱乐与探索，相关理论（syntergic theory / 转移电位）尚无主流科学定论。
实地前往请注意安全、守法，勿擅闯私人或危险区域，结伴而行，量力而止。
