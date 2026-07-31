const requestPromise = require('request-promise');

const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const numset = '0123456789'.split('');
const random = (x = 0, y = 1) => Math.floor(Math.random() * (y - x + 1)) + x;

const generateId = (len, numbersOnly) => {
  const set = numbersOnly ? numset : charset;
  let r = '';
  for (let i = 0; i < len; i++) { 
    r += set[random(0, set.length - 1)];
  }
  return r;
};

const request = async (url, proxy) => {
  try {
    const content = await requestPromise({ 
      url: url, 
      proxy: proxy, 
      method: "GET",
      headers: url.match(/https:\/\/\w+\.roblox\.com/) ? undefined : { 
        "traceparent": `00-${generateId(49)}-00`, 
        "Roblox-Id": generateId(16, true), 
        "User-Agent": `Roblox/WinInet`, 
        "Krnl-Fingerprint": generateId(16) 
      } 
    });
    return [ true, content ];
  } catch (err) {
    if (!err.statusCode) return [ false, "> Unable to fetch url, message: Unable to establish connection." ];
    return [ false, `> Unable to fetch url, message: ${err.statusCode}: ${err.response ? err.response.statusMessage : "NO_STATUS_MESSAGE"}` ];
  }
};

module.exports = { request };
