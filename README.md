# 发卡站（最小可用）- Node.js + Express + PostgreSQL + Docker

这是一个**最基础可跑通**的「发卡网站」骨架项目：

- ✅ **顾客端**：无需登录，直接浏览商品 → 填写联系方式 → 下单 →（演示支付）→ 自动发货（展示卡密）
- ✅ **商家端**：账号密码登录 → 商品管理 → 导入库存（卡密）→ 订单管理/手动发货
- ✅ **数据库**：PostgreSQL
- ✅ **部署**：Docker Compose 一键启动

> 注意：本项目默认提供“演示支付”（点击按钮即视为已支付）。  
> 你可以在上线时接入真实支付，然后在支付回调中调用 `/webhook/payment` 来完成自动发货。

---

## 目录结构

- `src/`：应用代码
- `src/views/`：EJS 页面模板（Bootstrap CDN）
- `db/init.sql`：数据库初始化建表脚本（首次启动 Postgres 时自动执行）
- `docker-compose.yml`：一键部署
- `.env.example`：环境变量示例

---

## 一、部署前准备

### 1）服务器要求
- 任意 Linux 服务器（Ubuntu / Debian / CentOS 均可）
- 已安装 Docker + Docker Compose（推荐 Docker 官方安装方式）

### 2）开放端口
- 默认 Web 端口：`3000`
- 如果你要公网访问，请在安全组/防火墙放行 `3000/tcp`（或改为 80/443 并反代）

---

## 二、一步一步部署（Docker Compose）

### Step 1：上传并解压项目
把项目文件夹上传到服务器，比如 `/opt/fakan-express`：

```bash
mkdir -p /opt/fakan-express
cd /opt/fakan-express
# 上传解压后应能看到 docker-compose.yml、Dockerfile、src、db 等文件
```

### Step 2：创建 .env 配置文件
复制示例：

```bash
cp .env.example .env
```

编辑 `.env`（强烈建议修改下面这些）：

- `SESSION_SECRET`：会话密钥（>= 16 位随机字符串）
- `CARD_SECRET`：卡密加密密钥（>= 16 位随机字符串）
- `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`：首次管理员账号密码
- `RESERVE_MINUTES`：下单后库存预留分钟数（默认 30 分钟）

可选：如果你想改外部访问端口：

- `APP_PORT=3000`（Docker 会把宿主机该端口映射到容器 3000）

### Step 3：启动服务
在项目根目录执行：

```bash
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f app
```

> 第一次启动会拉取镜像、安装依赖，稍等片刻再访问。

### Step 4：访问网站
- 前台：`http://<你的服务器IP>:3000/`
- 后台：`http://<你的服务器IP>:3000/admin/login`

> 后台登录使用 `.env` 里设置的 `BOOTSTRAP_ADMIN_USERNAME/BOOTSTRAP_ADMIN_PASSWORD`  
> （仅当数据库里没有任何 admin 时才会自动创建。）

---

## 三、上线后最小操作流程（从 0 到可售卖）

### 1）商家后台创建商品
进入 `/admin/products`：
- 新增商品（名称、描述、价格、上架勾选）
- 保存

### 2）导入库存（卡密）
在商品列表点「库存」：
- 粘贴卡密（每行一条）
- 点击导入  
系统会根据同一商品的 `sha256(卡密内容)` 自动去重，重复不会重复导入。

### 3）前台下单
前台点商品：
- 填写联系方式
- 输入购买数量
- 提交订单  
系统会**立刻预留对应数量的卡密**（防超卖），订单在 `RESERVE_MINUTES` 内未支付会自动过期并释放预留库存。

### 4）演示支付并发货
订单页点击「去支付」：
- 点击“我已完成支付（演示）” → 订单变为 delivered 并展示卡密

---

## 四、接入真实支付（可选）

项目提供一个通用 webhook：

- URL：`POST /webhook/payment`
- Header：`x-fakan-signature: <hex>`
- Body(JSON)：
```json
{ "order_no": "xxxx", "status": "success" }
```

签名算法（HMAC-SHA256）：
- `signature = HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, rawBody)` 输出 hex

你需要在 `.env` 中设置：
- `PAYMENT_WEBHOOK_SECRET=...`

示例（本地/服务器上手动模拟回调）：

```bash
BODY='{"order_no":"替换为订单号","status":"success"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '你的PAYMENT_WEBHOOK_SECRET' | awk '{print $2}')

curl -X POST "http://127.0.0.1:3000/webhook/payment" \
  -H "Content-Type: application/json" \
  -H "x-fakan-signature: $SIG" \
  -d "$BODY"
```

---

## 五、常用运维命令

### 查看日志
```bash
docker compose logs -f app
docker compose logs -f db
```

### 重启
```bash
docker compose restart
```

### 停止
```bash
docker compose down
```

### 备份数据库
```bash
docker exec -t fakan_db pg_dump -U postgres fakan > backup.sql
```

### 恢复数据库（危险操作：会覆盖数据）
```bash
cat backup.sql | docker exec -i fakan_db psql -U postgres -d fakan
```

---

## 六、安全建议（建议上线前至少做这些）

1. **改默认管理员密码**（不要用 admin123456）
2. **改 SESSION_SECRET / CARD_SECRET**
3. 上 HTTPS（用 Nginx/Caddy 反代到 3000），并把 session cookie 的 `secure` 打开：
   - `.env` 设置：`TRUST_PROXY=1`、`COOKIE_SECURE=true`
4. 后台路径可更改（例如 `/merchant`），并加 IP 白名单/二次验证（可选）
5. 定期备份 Postgres

---

## License
For learning / internal use.
