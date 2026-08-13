// PM2 process definition for KAP Tracker.
// NOTE: this file only ever manages the `kap-tracker` app on port 3010.
// It never touches other PM2 processes running on the same machine.
module.exports = {
  apps: [
    {
      name: 'kap-tracker',
      script: 'server/src/index.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
      },
      error_file: 'logs/kap-tracker-error.log',
      out_file: 'logs/kap-tracker-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
