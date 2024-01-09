const dotenv = require("dotenv");
const shelljs = require("shelljs");

if (process.env.NODE_ENV !== "production") dotenv.config();

module.exports = class SslCertificate {
    async renew(urls = []) {
        if (!urls.length) return;

        return new Promise((resolve, reject) => {
            shelljs.exec(
                `certbot ${urls.map((url) => `-d ${url}`).join(" ")} --manual --preferred-challenges dns certonly --expand`,
                function (code, stdout, stderr) {
                    if (code) reject(stderr);
                    else {
                        // TODO: Extract certificate token to update to DnsProvider.updateTXTRecord
                        resolve(stdout);
                    }
                }
            );
        });
    }
};
