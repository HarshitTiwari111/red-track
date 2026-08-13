const ts = () => new Date().toISOString();

const write = (level, args) => {
  const line = `[${ts()}] [${level}]`;
  if (level === 'ERROR') console.error(line, ...args);
  else if (level === 'WARN') console.warn(line, ...args);
  else console.log(line, ...args);
};

export const logger = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => {
    if (process.env.NODE_ENV !== 'production') write('DEBUG', a);
  },
};

export default logger;
