// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});
// 

const env = {
  db_host: process.env.DB_HOST || "127.0.0.0",
  db_pass: process.env.DB_PASS || "",
  db_user: process.env.DB_USERNAME || "root",
  database: process.env.DB_DATABASE || "peapo",
  test_database_url: process.env.TEST_DATABASE_URL,
  secret: process.env.SECRET,
  port: process.env.PORT || 8000,
  environment: process.env.NODE_ENV,
};
export default env;