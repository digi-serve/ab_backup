const dotenv = require("dotenv");
const fs = require("fs");
const shelljs = require("shelljs");
const { parseString } = require("xml2js");

if (process.env.NODE_ENV !== "production") dotenv.config();

const CLOUD_STORAGE_USER = process.env.CLOUD_STORAGE_USER;
const CLOUD_STORAGE_PASSWORD = process.env.CLOUD_STORAGE_PASSWORD;
const CLOUD_STORAGE_URL = process.env.CLOUD_STORAGE_URL;
const CLOUD_FILE_EXPIRATION_IN_DAYS = process.env.CLOUD_FILE_EXPIRATION_IN_DAYS;

module.exports = class CloudStorage {
	constructor() {
	}

	async uploadFiles(folderPath = "", fileNames = []) {
		let tasks = [];

		fileNames.forEach((filename) => {
			tasks.push(this.uploadFile(folderPath, filename));
		});

		return await Promise.all(tasks);
	}

	async uploadFile(folderPath = "", fileName = "") {
		return new Promise((resolve) => {
			const tarFilePath = `${folderPath}/${fileName}`;

			// If file is not exists
			if (!fs.existsSync(tarFilePath)) {
				resolve();
				return;
			}

			// Upload
			shelljs.exec(
				`curl -u '${CLOUD_STORAGE_USER}:${CLOUD_STORAGE_PASSWORD}' -T ${tarFilePath} "${CLOUD_STORAGE_URL}/remote.php/dav/files/${CLOUD_STORAGE_USER}/${fileName}"`,
				function () {
					resolve();
				}
			);
		});
	}

	/**
	 * @method getExpiredFilenames
	 * 
	 * @returns {Array} - an array of file name that expired
	 */
	async getExpiredFilenames() {
		const expiredDate = new Date();
		expiredDate.setDate(expiredDate.getDate() - CLOUD_FILE_EXPIRATION_IN_DAYS);

		return Promise.resolve()
			// Pull file list
			.then(() => new Promise((next) => {
				// NOTE: <d:where><d:lt> does not work T T
				shelljs.exec(
					`curl -u '${CLOUD_STORAGE_USER}:${CLOUD_STORAGE_PASSWORD}' "${CLOUD_STORAGE_URL}/remote.php/dav/" -X SEARCH -H "content-Type: text/xml" --data '<?xml version="1.0" encoding="UTF-8"?><d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:basicsearch><d:select><d:prop><d:getlastmodified/></d:prop></d:select><d:from><d:scope><d:href>/files/${CLOUD_STORAGE_USER}</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where><d:gte><d:prop><d:getlastmodified/></d:prop><d:literal>${expiredDate.toGMTString()}</d:literal></d:gte></d:where><d:orderby/></d:basicsearch></d:searchrequest>'`,

					function (code, stdout, stderr) {
						let result = stdout;

						next(result);
					}
				);
			}))
			// Convert XML to JSON
			.then((xmlResult) => new Promise((next) => {
				parseString(xmlResult, (err, jsonResult) => {
					next(jsonResult);
				})
			}))
			// Return expired file list
			.then((jsonResult) => new Promise((next) => {
				const resultStatus = jsonResult["d:multistatus"];
				if (!resultStatus) return next([]);

				const itemList = resultStatus["d:response"];
				if (!itemList || !itemList.length) return next([]);

				let result = [];

				itemList.forEach((item) => {
					const propStat = item["d:propstat"][0];
					if (!propStat) return;

					const itemProp = propStat["d:prop"][0];
					if (!itemProp) return;

					let updateDate = itemProp["d:getlastmodified"][0];
					if (!updateDate) return;

					// Convert to Date object
					updateDate = new Date(updateDate);

					if (updateDate < expiredDate) {
						const fileLink = item["d:href"][0];
						// Get file name
						const fileName = fileLink.split("/")[5];

						result.push(fileName);
					}
				});

				next(result);
			}));
	}

	async clearExpiredFiles() {
		const fileNames = await this.getExpiredFilenames();
		let tasks = [];

		fileNames.forEach((fileName) => {
			tasks.push(new Promise((next) => {
				// Remove file
				shelljs.exec(`curl -u '${CLOUD_STORAGE_USER}:${CLOUD_STORAGE_PASSWORD}' -X "DELETE" "${CLOUD_STORAGE_URL}/remote.php/dav/files/${CLOUD_STORAGE_USER}/${fileName}"`,
					function () {
						next();
					});
			}));
		});

		return await Promise.all(tasks);
	}
}
