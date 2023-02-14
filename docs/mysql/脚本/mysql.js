/**
 * nodejs连接mysql
 */
const fs = require("fs");
const mysql = require('mysql');
const os = require('os');

const connection = mysql.createConnection({
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: ''
});


connection.connect(function(err) {
    if (err) {
        return console.error('error: ' + err.message);
    }

    console.log('Connected to the MySQL server.');
});

async function test() {
    for (let i = 10000; i < 13000; i++) {
        if (i % 50 == 0) {
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
        let update = `UPDATE df_property_real_info_0000 SET property_index = ${i} WHERE id = ${i}`
        console.info(`sql`, update)

        // insert statment one
        // let insertSqlOne = `INSERT INTO ****(env,hb_pkg_id,hb_pkg_name,hb_pkg_version,create_by,platform,productId,status,app_version,app_version_num,is_lite)
        //             VALUES('test',4553,'7x24hours/index','1.2.6','import',1,1,1,680,680,0)`;
        connection.query(update, (error, results, fields) => {
            if (error) {
                return console.error(error.message);
            }
            console.log(results);
        });
    }
    connection.end();
}

let sql = "SELECT `deviceId` FROM `***` WHERE `property_index` IN (SELECT `property_index` FROM `****` WHERE `task_name` = 'PureAdRunnable' AND `task_state` = 3)";

connection.query(sql, (error, results, fields) => {
    if (error) {
        return console.error(error.message);
    }
    console.log(results);
    for (let item of results) {
        fs.appendFile("/Users/hanxiang1/work/Code_test/test/deviceid.txt", item.deviceId + os.EOL, (err, data) => {
            if (err) throw err;
        });
    }
});



connection.end();