FROM denoland/deno:1.40.0

# 设置工作目录
WORKDIR /app

# 复制源代码
COPY . .

# 缓存依赖
RUN deno cache src/main.ts

# 创建数据目录
RUN mkdir -p /app/data/accounts

# 暴露端口
EXPOSE 8080

# 设置默认环境变量
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV DEBUG=false

# 运行应用
CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/main.ts"]