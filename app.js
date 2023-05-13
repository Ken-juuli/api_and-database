
const express = require('express')
const app = express()
const mysql = require('mysql')
const con = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Taro7043',
  database: 'college'
});


app.set("view engine", "ejs");

app.get('/', (request, response) => {
	const sql = "SELECT * FROM student"
	con.query(sql, function (err, result, fields) {  
	if (err) throw err;
	response.send(result)
	});
});

app.listen(3000);