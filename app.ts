const express = require('express');
const app = express();
const appInsights = require('applicationinsights');

const env = process.env.NODE_ENV || 'development';
const port = process.env.PORT || 
  (env === 'producton' || env == 'staging' ? 80 : 3000);
  
if (env === 'production') {
  appInsights.setup("128ce831-0196-468a-945d-9dcd34992fcf").start();
}

app.get('/', (_: any, res: any) => {
  // const filename = env === 'development' ? 'index.development' : 'index';
  res.sendFile(`${__dirname}/index.${env}.html`)
});

app.use('/app', express.static('app'));

app.use('/images', express.static('images'));

app.use('/node_modules', express.static('node_modules'));

app.get('/authsuccess', (_: any, res: any) => res.end('Authentication completed...'));

app.use((req: any, res: any) => {
  res.status(404);

  if (req.accepts('html') || !req.accepts('json')) {
    res.send('Error 404 - not found');
  } else if (req.accepts('json')) {
    res.send({ statusCode: 404, error: 'Not found' });
  }
});

app.listen(port, () => console.log(`KPI Export 2 app listening on port ${port}!`));
