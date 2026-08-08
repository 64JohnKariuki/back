const Axios = require('axios');
const qs = require('qs');

// Load environment variables based on NODE_ENV
require('dotenv').config({
  path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development'
});

const Url = 'https://api.ultramsg.com/instance80190/messages/chat';

exports.sendWhatsAppMessage = async (phone, message) => {
    try {
        const data = qs.stringify({
          "to": phone,
          "body": message,
          "priority": 1
        });

        const config = {
            method: 'post',
            url: process.env.WHATSAPP_URL, // Check API documentation for correct endpoint
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: data
        };

        const response = await axios(config);
        console.log("Message sent:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error sending message:", error.response?.data || error.message);
        return null;
    }
};

exports.sendWhatsAppInvoice = async (phone, invoiceDetails, invoice) => {
  try {
      const invoiceText = `Hello ${ invoiceDetails.name},\n\n` +
          `Your invoice is ready!\n` +
          `Download it here: ${invoice}\n` +
          `Thank you for your business!`;

      const data = qs.stringify({
          "token": process.env.WHATSAPP_API_TOKEN, // Replace with your actual UltraMsg token
          "to": phone,
          "body": invoiceText,
          "priority": 1,
          "referenceId": "",
          "msgId": "",
          "mentions": ""
      });

      const config = {
          method: 'post',
          url: Url,
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
          },
          data: data
      };

      const response = await Axios(config);
      console.log("WhatsApp Invoice Sent:", response.data);
  } catch (error) {
      console.error("Error sending WhatsApp invoice:", error);
  }
};