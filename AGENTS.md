# 项目约定与部署手册

## 默认交付要求

- 本项目是单文件、无构建步骤的二胡调音器，运行入口为 `index.html`。
- 保持手机竖屏优先：双弦指板是主画面，使用分页切换功能，不恢复左右分栏或整页纵向滚动。
- **以后修改完成并通过验证后，默认同步更新 GitHub Pages 和既有云服务器。** 用户已明确授权这项常规发布流程，无需每次再次询问是否部署；用户明确要求仅本地修改、暂不发布时除外。
- 交付前核对两处站点的页面内容与本次源码一致，并给出访问地址。某一处失败必须明确说明，不能将“已推送”或“另一处成功”当成两处全部完成。
- 仅文档等非运行文件变更时，将变更提交、推送到 GitHub，并核验云端 `index.html` 与当前版本一致；一致时不必重复覆盖同一文件。
- 保留用户未提交的修改；不得强制推送、重建远程仓库或误覆盖其他服务。

## 已有部署目标

| 项目 | GitHub Pages | 云服务器 |
| --- | --- | --- |
| 访问地址 | https://minichao9901.github.io/erhu/ | https://43.139.216.219/ |
| 发布来源 | `https://github.com/minichao9901/erhu.git` | 当前工作区的 `index.html` |
| 位置 | `gh-pages` 分支根目录；`main` 同步更新 | `/var/www/erhu/index.html` |
| 发布方式 | 将同一提交推送到 `main` 和 `gh-pages` | SSH/SFTP 上传，备份后原子替换 |
| 服务配置 | Pages `build_type=legacy`、`source.branch=gh-pages`、`source.path=/` | Nginx：`/etc/nginx/sites-enabled/erhu` |

本地名为 `github` 的 remote 指向上述 GitHub 仓库。`origin` 指向旧 Gitee 仓库 `https://gitee.com/xu-jianchao/erhu-tuner.git`，**不能用默认的 `git push origin` 代替 GitHub 发布**。若 `github` remote 缺失，按上面的明确地址恢复即可，不需要重新寻找目标。

## 发布前验证

在项目根目录执行：

```powershell
node test/run-all.js
git diff --check
git status --short
```

涉及运行代码时必须通过现有 DSP、UI 与谱面测试。涉及布局时，至少检查 375×667 和 390×844 手机竖屏，确认完整双弦指板、操作按钮和底部分页没有遮挡或溢出。纯文档修改不必重跑与之无关的音频测试。

## GitHub Pages 更新

1. 检查 remote 和远程分支，避免覆盖其他人的新提交：

   ```powershell
   git remote -v
   git fetch github
   git log --oneline HEAD..github/main
   git log --oneline HEAD..github/gh-pages
   ```

2. 将本次相关修改提交到当前工作分支；有远程新提交时先正常整合，不能 force push。随后将同一提交同步到两个分支：

   ```powershell
   git push --atomic github HEAD:main HEAD:gh-pages
   ```

3. 通过 GitHub API `GET /repos/minichao9901/erhu/pages/builds/latest` 核对本次提交：`status` 必须为 `built`，`commit` 必须等于本次完整提交 SHA；失败时检查构建错误。已有部署配置可用 `GET /repos/minichao9901/erhu/pages` 读取。
4. 请求 `https://minichao9901.github.io/erhu/?v=<提交短SHA>`，确认 HTTP 200、版本内容正确。可用 `git show HEAD:index.html` 取得 GitHub 应发布的原始字节。
5. GitHub HTTPS 认证已使用 Git Credential Manager；若需调用 API，可按该主机读取现有 Git 凭据并仅在进程内使用。不要把令牌输出、写进仓库或放进命令行参数。

保留根目录 `.nojekyll`。不需要新建 GitHub 仓库、Sites 项目、Actions 工作流或切换 Pages 的既有发布方式。

## 云服务器连接

```text
主机：43.139.216.219
SSH 用户：agentuser
SSH 端口：443
SSH 命令：ssh -p 443 agentuser@43.139.216.219
SCP 端口参数：-P 443（大写 P）
站点目录：/var/www/erhu
首页：/var/www/erhu/index.html
备份目录：/var/backups/erhu
提权：agentuser 已验证可使用 sudo -n
```

**HTTPS 与 SSH 共用 443 端口。** 既有 Nginx stream 配置为 `/etc/nginx/stream.d/erhu-443.conf`，网页 TLS 由本机 `127.0.0.1:8443` 的 Nginx 站点处理。这是已正常工作的配置。不要因为 SSH 使用 443 就改端口、证书或复用配置；此前端更新无需重载或重启 Nginx。22 端口曾直接关闭连接，不能以它判断服务器无法登录。

认证与主机身份：

- 优先使用可用的现有 SSH 私钥或 agent；私钥具体路径尚未确认，不能编造“已配置好某个 key”。
- 2026-11-02 实际部署通过用户在当次会话提供的密码完成；**密码不记录在本文件、源码、部署脚本或提交历史中**。同一会话已提供的凭据可直接用于已授权更新。之后如没有可用密钥或凭据，只需补齐认证信息，不要让用户重新寻找主机、端口、站点目录。
- 已验证的服务器 RSA 主机公钥指纹：`SHA256:ESAaLCAWwhYFBJyC6OMXT2I37uzGZhdCfU3pI4omD5k`。
- 本机现有 Xshell 主机公钥文件为 `C:\Users\Administrator\Documents\NetSarang Computer\7\SECSH\HostKeys\key_43.139.216.219_22.pub`。文件名中的 `22` 是旧记录名称；其中公钥已实际验证可匹配 443 端口的 SSH 服务。
- 上述文件为 SSH2 公钥格式，可用 `ssh-keygen -i -f <公钥文件>` 转为 OpenSSH 格式；给专用 `known_hosts` 写入 `[43.139.216.219]:443 <公钥类型> <公钥内容>`。它是服务器主机公钥，**不是登录私钥**。保持严格主机身份验证；指纹变化时先查明原因。
- 无法在执行工具中交互输入密码时，可使用 Python Paramiko：严格加载已验证的主机公钥，通过子进程 stdin 将会话内凭据传入，仅驻留内存。不要将密码放进 shell 参数、环境文件或日志，不要提取应用保存的加密密码。

## 云服务器更新步骤

只发布本次运行所需文件。当前版本所有资源均内联，**只需更新 `index.html`**；不要上传曲目、视频、音频、测试资料、凭据或此部署手册到网站目录。

1. 计算待上传文件的 SHA-256，记录发布对应的 Git 提交。
2. 登录后核对 `/etc/nginx/sites-enabled/erhu` 的 document root 仍为 `/var/www/erhu`。现有站点根目录及文件由 root 管理，通过 `sudo -n` 执行必要的安装操作。
3. 读取现有 `/var/www/erhu/index.html`，核对与公网旧首页一致，并记录旧文件哈希。上传前后若发现其他人的并发更新，先处理冲突，不覆盖。
4. 使用 SFTP 或 `scp -P 443`，将本地 `index.html` 上传到 **agentuser 家目录下的唯一临时文件**，例如 `/home/agentuser/.erhu-release-<随机ID>.html`；将临时文件权限设为 0600，再校验上传后的哈希。
5. 在 `/var/backups/erhu/` 创建带 UTC 时间戳及随机后缀的旧首页备份，不能覆盖旧备份。建议备份目录权限 0750、备份文件权限 0640。备份存放在网站目录之外。
6. 在 `/var/www/erhu/` 内创建唯一临时文件，写入新内容并校验哈希；保持原首页的 owner/group 和访问权限。使用同一文件系统的 `os.replace` 或 `mv` 将它**原子替换**为 `index.html`，避免用户读到半写入文件。
7. 读取安装后的首页再次核对哈希，清理本次创建的暂存文件。无需改 Nginx 配置或重启任何服务。
8. 请求 `https://43.139.216.219/?v=<提交短SHA或文件哈希>`，再请求无参数的根地址；保持正常 TLS 验证，要求 HTTP 200 且内容与上传字节一致。网站使用 HTTPS 是手机麦克风正常工作的必要条件。
9. 保存本次部署时间、Git SHA、文件 SHA-256、备份路径和验证结果到本地 `analysis/cloud-deployment.json`。`analysis/` 已被 Git 忽略；**不得在此记录中保存密码或私钥**。

回滚时，选择已知正确的 `/var/backups/erhu/index-*.html`，同样先复制至网站目录的唯一临时文件、保持权限、原子替换首页，再验证公网内容。不要直接删除站点目录。

## 内容校验注意事项

- Windows 工作区 `index.html` 可能使用 CRLF，而 GitHub 中的 Git blob 使用 LF。比较两处站点或工作区与 Git blob 时，应统一换行后再比较，不能将仅有换行差异判为部署失败。
- 云端按本地原始字节上传，可直接与上传文件的 SHA-256 比较；GitHub Pages 则与该提交的 Git blob 比较。
- GitHub Pages 或公网访问出现网络错误时，保留已成功的部署和备份，报告哪一处构建成功、哪一处公网验证尚未完成，不反复覆盖文件。
- 最近已验证的云端更新发生于 **2026-11-02**，页面对应提交 `3f5bc49`；这是历史基准，后续发布必须使用当次新版本，不能把它写死为发布目标。
