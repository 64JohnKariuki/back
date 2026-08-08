const { S3Client } = require("@aws-sdk/client-s3");
 
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});
 
const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  
 
const BUCKET = process.env.R2_BUCKET_NAME;
const CDN_URL = (process.env.R2_CDN_URL || '').replace(/\/$/, '');
 
module.exports = { s3, BUCKET, CDN_URL };