const fs = require('fs');
const readline = require('readline');

async function loadLinesFromFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('A valid file path is required.');
  }

  await fs.promises.access(filePath, fs.constants.R_OK);

  const lines = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  return new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      if (line.trim() !== '') {
        lines.push(line);
      }
    });

    rl.on('close', () => {
      resolve(lines);
    });

    rl.on('error', (error) => {
      reject(error);
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  loadLinesFromFile,
};

