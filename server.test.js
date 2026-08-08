const request = require('supertest');
const server = require('./server'); // Import your Express server
const axios = require('axios');
const moment = require('moment');
const fs = require('fs');

// Mock console.log to avoid cluttering test output
console.log = jest.fn();
console.error = jest.fn();

jest.mock('axios');

describe('Server Tests', () => {
    let server; // Change to server to store the server instance
    let app; // To store the app instance

    afterAll((done) => {
        server.close(done);
    });

    it('should start the server and listen on a port', (done) => {
        server = app.listen(0, () => {
            expect(server.address()).toBeDefined();
            expect(server.address().port).toBeGreaterThan(0);
            done(); // Call done() when server is listening
        });
    });

    it('should respond with \'Home reached Success\' on the home route', async () => {
        const response = await request(app).get('/');
        expect(response.statusCode).toBe(200);
        expect(response.text).toBe('Home reached Success');
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Home page reached'), "MPESA DARAJA API WITH NODE JS BY UMESKIA SOFTWARES", expect.any(String));

    });

    it('should respond with an access token on the access token route', async () => {
        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });

        const response = await request(app).get('/route/access_token');
        expect(response.statusCode).toBe(200);
        expect(response.text).toContain('😀 Your access token is mocked_access_token');
    });

     it('should respond with 200 on successful STK push request', async () => {
        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });
         axios.post.mockResolvedValue({
            data: { ResponseCode: '0', ResponseDescription: 'Success' },
          });

        const response = await request(app)
            .post('/stkpush')
            .send({ phone: '0712345678', amount: '100' });
        expect(response.statusCode).toBe(200);
    });

     it('should handle STK push failure', async () => {
      axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });
        axios.post.mockResolvedValue({
            data: { ResponseCode: '1', ResponseDescription: 'Request failed' },
        });
        const response = await request(app)
        .post('/stkpush')
        .send({ phone: '0712345678', amount: '100' });
      expect(response.statusCode).toBe(500);
        expect(response.text).toContain('❌ Request failed: Request failed');
    });

    it('should respond with 200 on the callback route for successful transaction', async () => {
         const response = await request(app)
          .post('/callback')
          .send({
              Body: {
                stkCallback: {
                  ResultCode: 0,
                  MerchantRequestID: '123',
                  CheckoutRequestID: '456',
                },
              },
            });

        expect(response.statusCode).toBe(200);
       expect(console.log).toHaveBeenCalledWith("Transaction successful");
      });

    it('should handle duplicate successful transaction callbacks', async () => {
      const callbackPayload = {
        Body: {
          stkCallback: {
            ResultCode: 0,
            MerchantRequestID: '123',
            CheckoutRequestID: '789',
          },
        },
      };
      // First call should be successful
      let response = await request(app).post('/callback').send(callbackPayload);
      expect(response.statusCode).toBe(200);
      expect(console.log).toHaveBeenCalledWith("Transaction successful");

      // Second call for the same transaction should be ignored.
      response = await request(app).post('/callback').send(callbackPayload);
      expect(response.statusCode).toBe(200);
      expect(console.log).toHaveBeenCalledWith("Ignoring duplicate callback for:", '789');

    });

      it('should respond with 200 on callback route for cancelled transaction', async () => {
          const response = await request(app)
              .post('/callback')
              .send({
                  Body: {
                      stkCallback: {
                          ResultCode: 1032,
                          MerchantRequestID: '123',
                          CheckoutRequestID: '456',
                      },
                  },
              });

          expect(response.statusCode).toBe(200);
          expect(console.log).toHaveBeenCalledWith("Transaction cancelled by user");
      });

    it('should respond with 200 on the callback route for timeout transaction', async () => {

        const response = await request(app)
            .post('/callback')
             .send({
               CheckoutRequestID: "456",
            });
        expect(response.statusCode).toBe(200);
       expect(console.log).toHaveBeenCalledWith("Timeout callback received:", '456');
    });
    it('should respond with 200 on the callback route for duplicate timeout transaction', async () => {
        const response = await request(app)
            .post('/callback')
             .send({
               CheckoutRequestID: "456",
            });

        expect(response.statusCode).toBe(200);
       expect(console.log).toHaveBeenCalledWith("Ignoring duplicate timeout callback for:", '456');
    });

      it('should respond with 200 on the callback route for failed transaction', async () => {
          const response = await request(app)
            .post('/callback')
            .send({
              Body: {
                stkCallback: {
                  ResultCode: 1037,
                    MerchantRequestID: '123',
                    CheckoutRequestID: '456',
                },
              },
            });
          expect(response.statusCode).toBe(200);
           expect(console.log).toHaveBeenCalledWith("Transaction timed out");
      });

     it('should respond with 200 on the callback route for other failed transaction', async () => {
        const response = await request(app)
          .post('/callback')
          .send({
            Body: {
              stkCallback: {
                ResultCode: 1,
                MerchantRequestID: '123',
                 CheckoutRequestID: '456',
              },
            },
          });
         expect(response.statusCode).toBe(200);
          expect(console.log).toHaveBeenCalledWith("Transaction failed with ResultCode:", 1);
    });

    it('should respond with 200 on the registerurl route', async () => {
        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });
         axios.post.mockResolvedValue({ data: {} });

        const response = await request(app).get('/registerurl');
        expect(response.statusCode).toBe(200);
    });

    it('should respond with 200 on the b2curlrequest route', async () => {
        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });
        axios.post.mockResolvedValue({ data: {} });

        const response = await request(app).get('/b2curlrequest');
        expect(response.statusCode).toBe(200);
    });
     it('should handle server errors', async () => {
        const response = await request(app).get('/invalid-route'); // Simulate a route not found
        expect(response.statusCode).toBe(404); // Or the status code your app uses for "Not Found"
    });
        it('should log and return 500 for uncaught errors', async () => {
      // Mock a route that throws an error
      app.get('/error', (req, res) => {
        throw new Error('Test error');
      });
       const response = await request(app).get('/error');
      expect(response.statusCode).toBe(500);
      expect(response.text).toBe('Something broke!');
       expect(console.error).toHaveBeenCalled();
     });

      it('should respond with 200 on /confirmation route', async () => {
        const response = await request(app)
            .get('/confirmation')
            .send({ /*  mock request body */ });
        expect(response.statusCode).toBe(200);
        expect(console.log).toHaveBeenCalledWith("All transaction will be sent to this URL");
        expect(console.log).toHaveBeenCalledWith({});
    });

    it('should respond with 200 on /validation route', async () => {
          const response = await request(app)
            .get('/validation')
            .send({ /* mock request body */ });
        expect(response.statusCode).toBe(200);
          expect(console.log).toHaveBeenCalledWith("Validating payment");
           expect(console.log).toHaveBeenCalledWith({});
    });
});
print(default_api.write_file(path = "./server.test.js", content = "const request = require('supertest');\nconst app = require('./server'); // Import your Express app\nconst axios = require('axios');\nconst moment = require('moment');\nconst fs = require('fs');\n\n\n// Mock console.log to avoid cluttering test output\nconsole.log = jest.fn();\nconsole.error = jest.fn();\n\n\njest.mock('axios');\n\n\ndescribe('Server Tests', () => {\n    let server;\n\n    beforeAll((done) => {\n        server = app.listen(0, () => {\n            done();\n        });\n    });\n\n    afterAll((done) => {\n        server.close(done);\n    });\n\n    it('should start the server and listen on a port', () => {\n        expect(server).toBeDefined();\n        expect(server.address()).toBeDefined();\n        expect(server.address().port).toBeGreaterThan(0);\n    });\n\n    it('should respond with \'Home reached Success\' on the home route', async () => {\n        const response = await request(app).get('/');\n        expect(response.statusCode).toBe(200);\n        expect(response.text).toBe('Home reached Success');\n        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Home page reached'), \"MPESA DARAJA API WITH NODE JS BY UMESKIA SOFTWARES\", expect.any(String));\n\n    });\n\n    it('should respond with an access token on the access token route', async () => {\n        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });\n\n        const response = await request(app).get('/route/access_token');\n        expect(response.statusCode).toBe(200);\n        expect(response.text).toContain('😀 Your access token is mocked_access_token');\n    });\n\n     it('should respond with 200 on successful STK push request', async () => {\n        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });\n         axios.post.mockResolvedValue({\n            data: { ResponseCode: '0', ResponseDescription: 'Success' },\n          });\n\n        const response = await request(app)\n            .post('/stkpush')\n            .send({ phone: '0712345678', amount: '100' });\n        expect(response.statusCode).toBe(200);\n    });\n\n     it('should handle STK push failure', async () => {\n      axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });\n        axios.post.mockResolvedValue({\n            data: { ResponseCode: '1', ResponseDescription: 'Request failed' },\n        });\n        const response = await request(app)\n        .post('/stkpush')\n        .send({ phone: '0712345678', amount: '100' });\n      expect(response.statusCode).toBe(500);\n        expect(response.text).toContain('❌ Request failed: Request failed');\n    });\n\n    it('should respond with 200 on the callback route for successful transaction', async () => {\n         const response = await request(app)\n          .post('/callback')\n          .send({\n              Body: {\n                stkCallback: {\n                  ResultCode: 0,\n                  MerchantRequestID: '123',\n                  CheckoutRequestID: '456',\n                },\n              },\n            });\n\n        expect(response.statusCode).toBe(200);\n       expect(console.log).toHaveBeenCalledWith(\"Transaction successful\");\n      });\n\n      it('should respond with 200 on callback route for cancelled transaction', async () => {\n          const response = await request(app)\n              .post('/callback')\n              .send({\n                  Body: {\n                      stkCallback: {\n                          ResultCode: 1032,\n                          MerchantRequestID: '123',\n                          CheckoutRequestID: '456',\n                      },\n                  },\n              });\n\n          expect(response.statusCode).toBe(200);\n          expect(console.log).toHaveBeenCalledWith(\"Transaction cancelled by user\");\n      });\n\n    it('should respond with 200 on the callback route for timeout transaction', async () => {\n\n        const response = await request(app)\n            .post('/callback')\n             .send({\n               CheckoutRequestID: \"456\",\n            });\n        expect(response.statusCode).toBe(200);\n       expect(console.log).toHaveBeenCalledWith(\"Timeout callback received:\", '456');\n    });\n    it('should respond with 200 on the callback route for duplicate timeout transaction', async () => {\n        const response = await request(app)\n            .post('/callback')\n             .send({\n               CheckoutRequestID: \"456\",\n            });\n\n        expect(response.statusCode).toBe(200);\n       expect(console.log).toHaveBeenCalledWith(\"Ignoring duplicate timeout callback for:\", '456');\n    });\n\n      it('should respond with 200 on the callback route for failed transaction', async () => {\n          const response = await request(app)\n            .post('/callback')\n            .send({\n              Body: {\n                stkCallback: {\n                  ResultCode: 1037,\n                    MerchantRequestID: '123',\n                    CheckoutRequestID: '456',\n                },\n              },\n            });\n          expect(response.statusCode).toBe(200);\n           expect(console.log).toHaveBeenCalledWith(\"Transaction timed out\");\n      });\n\n     it('should respond with 200 on the callback route for other failed transaction', async () => {\n        const response = await request(app)\n          .post('/callback')\n          .send({\n            Body: {\n              stkCallback: {\n                ResultCode: 1,\n                MerchantRequestID: '123',\n                 CheckoutRequestID: '456',\n              },\n            },\n          });\n         expect(response.statusCode).toBe(200);\n          expect(console.log).toHaveBeenCalledWith(\"Transaction failed with ResultCode:\", 1);\n    });\n    \n    it('should respond with 200 on the registerurl route', async () => {\n        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });\n         axios.post.mockResolvedValue({ data: {} });\n\n        const response = await request(app).get('/registerurl');\n        expect(response.statusCode).toBe(200);\n    });\n\n    it('should respond with 200 on the b2curlrequest route', async () => {\n        axios.get.mockResolvedValue({ data: { access_token: 'mocked_access_token' } });\n        axios.post.mockResolvedValue({ data: {} });\n\n        const response = await request(app).get('/b2curlrequest');\n        expect(response.statusCode).toBe(200);\n    });\n});\n"))