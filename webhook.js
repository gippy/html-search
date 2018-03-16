const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json()); // for parsing application/json

app.post('/', function(req, res){
  const { body } = req;
  console.log(body);
  return res.json(body);
});

app.listen(3000);
