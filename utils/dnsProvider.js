const dotenv = require("dotenv");
const shelljs = require("shelljs");

if (process.env.NODE_ENV !== "production") dotenv.config();

const DNS_API_KEY = process.env.DNS_API_KEY;
const DNS_EMAIL_ACCOUNT = process.env.DNS_EMAIL_ACCOUNT;
const DNS_ZONE_ID = process.env.DNS_ZONE_ID;

module.exports = class DnsProvider {

    async getRecords() {
        return new Promise((resolve, reject) => {
            shelljs.exec(
                `curl --request GET \
                    --url https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records \
                    --header 'Content-Type: application/json' \
                    --header 'X-Auth-Email: ${DNS_EMAIL_ACCOUNT}' \
                    --header 'X-Auth-Key: ${DNS_API_KEY}'
                `,
                function (code, stdout, stderr) {
                    if (code) reject(stderr);
                    else {
                        try {
                            const data = JSON.parse(stdout);
                            resolve(data["result"]);
                        }
                        catch (err) {
                            reject(err);
                        }
                    }
                }
            );
        });
    }

    async updateTXTRecord(recordId, content) {
        return new Promise((resolve, reject) => {
            shelljs.exec(
                `curl --request PUT \
                    --url https://api.cloudflare.com/client/v4/zones/${DNS_ZONE_ID}/dns_records/${recordId} \
                    --header 'Content-Type: application/json' \
                    --header 'X-Auth-Email: ${DNS_EMAIL_ACCOUNT}' \
                    --header 'X-Auth-Key: ${DNS_API_KEY}' \
                    --data '{"name":"_acme-challenge.childatrisk.in.th","content":"${content}","type":"TXT"}'
                `,
                function (code, stdout, stderr) {
                    if (code) reject(stderr);
                    else {
                        try {
                            const data = JSON.parse(stdout);
                            resolve(data["result"]);
                        }
                        catch (err) {
                            reject(err);
                        }
                    }
                }
            );
        });
    }
};
