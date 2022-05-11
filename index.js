const path = require("path");

const dotenv = require("dotenv");
const shelljs = require("shelljs");
const nodeCron = require("node-cron");

if (process.env.NODE_ENV !== "production") dotenv.config();

const backup = nodeCron.schedule(process.env.NODE_CRON_EXPRESSION, () => {
   const mysql = {
      user: process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      db: process.env.MYSQL_DATABASE,
      tenantUUIDs: [],
   };
   // const mysql = {
   //    host: process.env.MYSQL_HOST,
   //    port: process.env.MYSQL_PORT,
   //    user: process.env.MYSQL_USERNAME,
   //    password: process.env.MYSQL_PASSWORD,
   //    db: process.env.MYSQL_DATABASE,
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
   const pathLocalStorage = path.resolve("storage");
   const pathContainerDatabaseStorage = "/root/storage";
   const pathContainerFileProcessorTenant = "/data";

   shelljs.mkdir("-p", pathLocalStorage);
   shelljs.exec(
      `docker exec ${containerDatabaseID} sh -c "mkdir -p ${pathContainerDatabaseStorage}"`
   );
   mysql.tenantUUIDs = shelljs
      .exec(
         `docker exec ${containerDatabaseID} sh -c "mysql -u\\"${mysql.user}\\" -p\\"${mysql.password}\\" -e 'select * from \\\`${mysql.db}-admin\\\`.\\\`site_tenant\\\`'" | awk 'FNR > 1 {print $2}'`,
         { silent: true }
      )
      // .exec(
      //    `docker exec ${containerDatabaseID} sh -c "mysql -u\\"${mysql.user}\\" -p\\"${mysql.password}\\"  -h ${mysql.host} -P ${mysql.port} -e 'select * from \\\`${mysql.db}-admin\\\`.\\\`site_tenant\\\`'" | awk 'FNR > 1 {print $2}'`,
      //    { silent: true }
      // )
      .toString()
      .split("\n")
      .filter((e) => e !== "");

   for (let index = 0, retry = 0; index < mysql.tenantUUIDs.length; index++) {
      const dateNowString = new Date(Date.now()).toString();
      const dateNowStringFormatCommandLine = dateNowString
         .replace(/\s/g, "\\ ")
         .replace(/\(/g, "\\(")
         .replace(/\)/g, "\\)")
         .replace(/:/g, "#")
      const dbName = `${mysql.db}-${mysql.tenantUUIDs[index]}`;
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
      const commands = [
         `docker exec ${containerDatabaseID} sh -c "mysqldump --max_allowed_packet=512M -u\\"${mysql.user}\\" -p\\"${mysql.password}\\" \\"${dbName}\\" > ${pathContainerFileSQL} 2> /dev/null"`,
         // `docker exec ${containerDatabaseID} sh -c "mysqldump --max_allowed_packet=512M -u\\"${mysql.user}\\" -p\\"${mysql.password}\\" -h ${mysql.host} -P ${mysql.port} \\"${dbName}\\" > ${pathContainerFileSQL} 2> /dev/null"`,
         `docker cp ${containerDatabaseID}:${pathContainerFileSQL} ${pathLocalDirectoryTenant}`,
         `docker exec ${containerFileProcessorID} sh -c "mkdir -p ${pathCointainerDirectoryTenant}"`,
         `docker cp ${containerFileProcessorID}:${pathCointainerDirectoryTenant}/. ${pathLocalDirectoryData}`,
         `cd ${pathLocalStorage}`,
         `tar -czvf \\(${dateNowStringFormatCommandLine}\\)\\ ${mysql.tenantUUIDs[index]}.tar.gz ${mysql.tenantUUIDs[index]}`,
      ].join(" && ");

      shelljs.mkdir("-p", pathLocalDirectoryData);

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
         console.error(error);
         console.error();
         index--;
         retry++;
      } finally {
         console.log(
            `Backup DB at "${dateNowString}": ${
               !retry ? "Success" : "Fail"
            }! (${dbName})`
         );

         if (retry === 3) {
            retry = 0;
            index++;
         }
      }
   }
   console.log();

   shelljs.exec(
      `docker exec ${containerDatabaseID} sh -c "rm -rf ${pathContainerDatabaseStorage}" && find ${pathLocalStorage} -type f -mtime +${fileExpirationInDays} -delete`
   );
});

backup.start();
