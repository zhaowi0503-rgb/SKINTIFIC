# GitHub Actions 部署指南

## 📋 部署步骤

### 1. 创建GitHub仓库

```bash
cd /Users/skintific

# 初始化git仓库
git init

# 添加文件
git add brand_sales_analysis.py
git add dingtalk_push.py
git add scheduled_report.py
git add .github/workflows/daily_report.yml

# 提交
git commit -m "Initial commit: Daily sales report automation"

# 在GitHub上创建新仓库（私有仓库，保护敏感信息）
# 然后关联远程仓库
git remote add origin https://github.com/YOUR_USERNAME/skintific-sales-report.git
git branch -M main
git push -u origin main
```

### 2. 配置GitHub Secrets

在GitHub仓库页面：
1. 点击 `Settings` → `Secrets and variables` → `Actions`
2. 点击 `New repository secret`，添加以下3个secrets：

#### Secret 1: GOOGLE_CREDENTIALS
- Name: `GOOGLE_CREDENTIALS`
- Value: 复制 `/Users/weizhao/Downloads/skintific-492616-339ab13aea8e.json` 文件的完整内容

```bash
# 查看凭证文件内容（复制输出）
cat /Users/weizhao/Downloads/skintific-492616-339ab13aea8e.json
```

#### Secret 2: DINGTALK_WEBHOOK
- Name: `DINGTALK_WEBHOOK`
- Value: `https://oapi.dingtalk.com/robot/send?access_token=1cb6336bc58ab0740987d90bf7808549c35be0d77edd5a4398052cb6d6f06103`

#### Secret 3: DINGTALK_SECRET (可选)
- Name: `DINGTALK_SECRET`
- Value: 留空（因为你没有设置加签）

### 3. 修改workflow文件中的凭证路径

已自动配置为使用环境变量，无需手动修改。

### 4. 测试运行

#### 方法1: 手动触发测试
1. 进入GitHub仓库
2. 点击 `Actions` 标签
3. 选择 `Daily Sales Report` workflow
4. 点击 `Run workflow` → `Run workflow`
5. 查看运行日志

#### 方法2: 等待定时执行
- 每天 UTC 10:00（北京时间 18:00）自动执行

### 5. 查看执行日志

1. 进入 `Actions` 标签
2. 点击具体的workflow运行记录
3. 查看每个步骤的详细日志

## ⚙️ 时区说明

- GitHub Actions使用UTC时间
- `cron: '0 10 * * *'` = UTC 10:00 = 北京时间 18:00
- 如需修改时间，编辑 `.github/workflows/daily_report.yml` 中的cron表达式

## 🔧 常见问题

### Q: 如何修改执行时间？
A: 编辑 `.github/workflows/daily_report.yml`，修改cron表达式
```yaml
# 例如改为北京时间 20:00（UTC 12:00）
- cron: '0 12 * * *'
```

### Q: 如何查看执行失败原因？
A: 进入Actions → 点击失败的运行 → 查看红色标记的步骤日志

### Q: 凭证文件格式错误怎么办？
A: 确保GOOGLE_CREDENTIALS是完整的JSON内容，包括开头的 `{` 和结尾的 `}`

### Q: 如何停止定时任务？
A: 
- 方法1: 删除 `.github/workflows/daily_report.yml` 文件
- 方法2: 在workflow文件中注释掉schedule部分

### Q: GitHub Actions有使用限制吗？
A: 
- 公开仓库：无限制
- 私有仓库：每月2000分钟免费额度
- 本任务每次运行约1-2分钟，每月30次 = 60分钟，完全够用

## 📊 优势

✅ 无需本地电脑开机
✅ 完全免费（私有仓库也有足够额度）
✅ 自动执行，无需人工干预
✅ 可查看历史执行记录
✅ 支持手动触发测试

## 🔒 安全提示

- 仓库建议设为私有（Private）
- 敏感信息都存储在GitHub Secrets中，不会暴露在代码里
- Secrets内容在日志中会自动打码显示为 `***`
