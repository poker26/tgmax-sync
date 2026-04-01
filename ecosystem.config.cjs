module.exports = {
  apps: [
    {
      name: "tgmax-sync-worker",
      cwd: "/root/tgmax-sync",
      script: "npm",
      args: "run sync:worker -- --source-channel @replace_me --max-chat-id -1000000000000",
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
