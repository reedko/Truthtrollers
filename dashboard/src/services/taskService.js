// taskService.js
const connection = require('./database'); // Assuming you have a separate file for your database connection

const getTasks = () => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM tasks';
        connection.query(sql, (err, results) => {
            if (err) {
                return reject(err);
            }
            resolve(results);
        });
    });
};

module.exports = { getTasks };