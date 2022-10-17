const fs = require("fs");
const path = require("path");
const https = require("https");

const dotenv = require("dotenv");
const shelljs = require("shelljs");

const CloudStorage = require("./utils/cloudStorage.js");

if (process.env.NODE_ENV !== "production") dotenv.config();

const config = require(`${process.env.AB_PATH}/config/local.js`);
const cloudStorage = new CloudStorage();

const mysql = {
   user: config.datastores.appbuilder.user,
   password: config.datastores.appbuilder.password,
   database: config.datastores.appbuilder.database,
   tenantUUIDs: [],
};
// const mysql = {
//    host: "127.0.0.1",
//    port: config.datastores.appbuilder.port,
//    user: config.datastores.appbuilder.user,
//    password: config.datastores.appbuilder.password,
//    database: config.datastores.appbuilder.database,
//    tenantUUIDs: [],
// };
const fileExpirationInDays = process.env.FILE_EXPIRATION_IN_DAYS;
const containerDatabaseID = shelljs
   .exec("docker ps | grep \"_db\" | awk '{print $1}'", { silent: true })
   .toString()
   .split("\n")
   .filter((e) => e !== "")
   .join("");
const containerFileProcessorID = shelljs
   .exec("docker ps | grep \"_file_processor\" | awk '{print $1}'", {
      silent: true,
   })
   .toString()
   .split("\n")
   .filter((e) => e !== "")
   .join("");
const pathLocalStorage = process.env.STORAGE_PATH;
const pathContainerDatabaseStorage = "/root/storage";
const pathContainerFileProcessorTenant = "/data";

let healthcheck = process.env.HEALTH_CHECK_URL ?? null;

shelljs.mkdir("-p", pathLocalStorage);
shelljs.exec(
   `docker exec ${containerDatabaseID} sh -c "mkdir -p ${pathContainerDatabaseStorage}"`
);
mysql.tenantUUIDs = shelljs
   .exec(
      `docker exec ${containerDatabaseID} sh -c "mysql -u\\"${mysql.user}\\" -p\\"${mysql.password}\\" -e 'select * from \\\`${mysql.database}-admin\\\`.\\\`site_tenant\\\`'" | awk 'FNR > 1 {print $2}'`,
      { silent: true }
   )
   // .exec(
   //    `docker exec ${containerDatabaseID} sh -c "mysql -u\\"${mysql.user}\\" -p\\"${mysql.password}\\"  -h ${mysql.host} -P ${mysql.port} -e 'select * from \\\`${mysql.database}-admin\\\`.\\\`site_tenant\\\`'" | awk 'FNR > 1 {print $2}'`,
   //    { silent: true }
   // )
   .toString()
   .split("\n")
   .filter((e) => e !== "");

let tarFileList = [];
let errorMessages = [];

for (let index = 0, retry = 0; index < mysql.tenantUUIDs.length; index++) {
   const dateNowString = new Date().toISOString().replace(/:/g, ".");
   const dbName = `${mysql.database}-${mysql.tenantUUIDs[index]}`;
   const pathLocalDirectoryTenant = path.join(
      pathLocalStorage,
      mysql.tenantUUIDs[index]
   );
   const pathLocalDirectoryData = path.join(
      `${pathLocalDirectoryTenant}`,
      "data"
   );
   const pathCointainerDirectoryTenant = `${pathContainerFileProcessorTenant}/${mysql.tenantUUIDs[index]}`;
   const pathContainerFileSQL = `${pathContainerDatabaseStorage}/${dbName}.sql`;
   const tarFilename = `${mysql.tenantUUIDs[index]}_${dateNowString}.tar.gz`;
   const commands = [
      `docker exec ${containerDatabaseID} sh -c "mysqldump --max_allowed_packet=512M -u\\"${mysql.user}\\" -p\\"${mysql.password}\\" \\"${dbName}\\" > ${pathContainerFileSQL} 2> /dev/null"`,
      `docker cp ${containerDatabaseID}:${pathContainerFileSQL} ${pathLocalDirectoryTenant}`,
      // `mysqldump --max_allowed_packet=512M -u"${mysql.user}" -p"${mysql.password}" -h ${mysql.host} -P ${mysql.port} "${dbName}" > ${pathLocalDirectoryTenant} 2> /dev/null`,
      `docker exec ${containerFileProcessorID} sh -c "mkdir -p ${pathCointainerDirectoryTenant}"`,
      `docker cp ${containerFileProcessorID}:${pathCointainerDirectoryTenant}/. ${pathLocalDirectoryData}`,
      `cd ${pathLocalStorage}`,
      `tar -czvf ${tarFilename} ${mysql.tenantUUIDs[index]}`,
   ].join(" && ");

   shelljs.mkdir("-p", pathLocalDirectoryData);

   if (tarFileList.indexOf(tarFilename) < 0)
      tarFileList.push(tarFilename);

   try {
      const result = shelljs.exec(commands, {
         silent: true,
         timeout: 300000,
      });

      shelljs.rm("-rf", pathLocalDirectoryTenant);

      if (result.code) {
         const error = result.stderr;

         shelljs.rm("-rf", `${pathLocalDirectoryTenant}*`);
         shelljs.exec(
            `docker exec ${containerDatabaseID} sh -c "rm -rf ${pathContainerFileSQL}"`
         );

         if (error.length) throw new Error(error);

         throw new Error(`No such database "${dbName}"`);
      }

      retry = 0;
   } catch (error) {
      errorMessages.push(error.message ?? String(error));
      console.error(error);
      console.error();
      index--;
      retry++;
   } finally {
      let message = `Backup DB at "${dateNowString}": ${
         !retry ? "Success" : "Fail"
      }! (${dbName})`;
      console.log(message);

      if (retry > 0) {
         errorMessages.push(message);
      }

      if (retry === 3) {
         retry = 0;
         index++;
      }
   }
}

//// Healthchecks.io
if (!healthcheck) {
   console.warn("No Healthchecks URL was configured. Cannot send ping.")
}
// No errors. Send normal ping.
else if (errorMessages.length == 0) {
   https.get(healthcheck).on('error', (error) => {
      console.log(`Ping failed: ${error.message ?? error}`);
   });
} 
// Send Fail ping.
else {
   let req = https.request(`${healthcheck}/fail`, {
      method: "POST"
   });
   req.on('error', (error) => {
      console.log(`Ping failed: ${error.message ?? error}`);
   });
   // Log error messages to Healthchecks.
   req.write(errorMessages.join("\n"));
   req.end();
}

// Upload backup files to Cloud Storage
cloudStorage.uploadFiles(pathLocalStorage, tarFileList).then(() => {});

console.log();

shelljs.exec(
   `docker exec ${containerDatabaseID} sh -c "rm -rf ${pathContainerDatabaseStorage}" && find ${pathLocalStorage} -type f -mtime +${fileExpirationInDays} -delete`
);

// Clear expired files on Cloud Storage
cloudStorage.clearExpiredFiles().then(() => {});
