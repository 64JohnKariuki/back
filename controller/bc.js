// bookingController.js
const bookModel = require("../models/bookModel");
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
var qs = require('qs');
const path = require('path');
const Axios = require("axios");
const Handlebars = require('handlebars');

const {google} = require('googleapis');
const reqValidator = require('../Utility/requirement-validator.js');
const appUtil = require('../Utility/appUtil.js');
const { createInvoice } = require('../helpers/pdfGenerator.js')
const { createPayment } = require('../helpers/intasend.js')

// Calendar
const gcal = require('../Utility/gcal.js');
const cred = require('../Utility/credentials.json');

const days = require('../ReqHandlers/GET-Handlers/days.js');
const timeslots = require('../ReqHandlers/GET-Handlers/timeslots.js');
const book = require('../ReqHandlers/POST-Handlers/book.js');
const { time } = require("console");
const { GoogleAuth } = require('google-auth-library');
const { calendar } = require("googleapis/build/src/apis/calendar/index.js");

const { sendWhatsAppInvoice, sendWhatsAppMessage } = require('../whatsapp.js'); // Import your payment service
const Intasend = require('intasend-node');
const dotenv = require('dotenv');

dotenv.config();

let intasend = new Intasend(
  process.env.INTASEND_PUBLISHABLE_KEY,
  process.env.INTASEND_SECRET_KEY,
  true // Set to false in production
);

const collection = intasend.collection();
const payouts = intasend.payouts();
const wallets = intasend.wallets();
const refunds = intasend.refunds();

// Get the OAuth2 client for making Google Calendar API requests.
//gcal.initAuthorize(auth);

const auth = new GoogleAuth({
  keyFile: cred, // Path to your JSON key file
  scopes: ['https://www.googleapis.com/auth/calendar'], // Required scopes
});

/**
 * Handles 'days' GET requests.
 * @param {object} req  The requests object provided by Express. See Express doc.
 * @param {object} res  The results object provided by Express. See Express doc.
 */
function getBookedDays(events) {
  let bookedDays = [];
  let date = null;
  let prevDate = null;
  let dayArr = [];
  for (let event of events) {
      date = appUtil.getDateFromISO(event.start.dateTime);
      if (date === prevDate || prevDate === null) {
          dayArr.push(event);
      } else {
          dayArr = []; // Clear array.
          dayArr.push(event);
      }
      prevDate = appUtil.getDateFromISO(event.start.dateTime);
      if (dayArr.length === 11) {
          dayArr = []; // Clear array.
          bookedDays.push(date);
      }
  }
  return bookedDays;
}

/**
 * Uses the bookedDays value returned from getBookedDays() to create an array containing
 * info on whether the day has any timeslots available or not.
 * @param {number} endDate  End date of the month.
 * @param {number[]} bookedDays  An array containing the days that are fully booked.
 * @returns {object[]} daysArr  An array containing objects which represent the days of
 * the month, and whether the day has any timeslots available.
 */
function makeDaysArr(endDate, bookedDays) {
  let daysArr = [];
  for (let i = 1; i <= endDate; i++) {
      if (bookedDays.includes(i)) {
          daysArr.push({"day": i, "hasTimeSlots": false});
      } else {
          daysArr.push({"day": i, "hasTimeSlots": true});
      }
  }
  return daysArr;
}

/**
 * Handles 'timeslots' GET requests.
 * @param {object} req  The requests object provided by Express. See Express doc.
 * @param {object} res  The results object provided by Express. See Express doc.
 */
function handleGetTimeslots(req, res) {
    const year = req.query.year;
    const month = req.query.month;
    const day = req.query.day;
    timeslots.getAvailTimeslots(auth, year, month, day)
        .then(function(data) {
            res.send(data);
        })
        .catch(function(data) {
            res.send(data);
        });
}

/**
 * Handles 'book' POST requests.
 * @param {object} req  The requests object provided by Express. See Express doc.
 * @param {object} res  The results object provided by Express. See Express doc.
 */
async function getBookableDays(auth, date) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
      calendar.events.list({
        calendarId: 'primary',
      }, (err, res) => {
      if (err) return console.log('The API returned an error: ' + err);
      const events = res.data.items;
      if (events.length) {
        console.log('Upcoming 10 events:');
        events.map((event, i) => {
          const start = event.date;
          console.log(`${start} - ${event.summary}`);
        });
      } else {
        console.log('No upcoming events found.');
      }
    });
    return { success: true };

  } catch (err) {
    console.error('Error in getBookableDays:', err);
    throw { success: false, message: 'Failed to get bookable days.' }; 
  }
}

async function generateInvoice (req, res) {
  try {
      // Launch a new Puppeteer browser instance
      const browser = await puppeteer.launch({ headless: 'new' });
      const page = await browser.newPage();

      // Ensure 'temp' is defined and is a string
      const templatePath = path.join(__dirname, temp, 'invoice.hbs'); // Check 'temp' variable
      const templateSource = await fs.readFile(templatePath, 'utf-8');

      // Compile the Handlebars template
      const template = Handlebars.compile(templateSource);

      // Extract invoice data from the request body or app locals
      const invoiceData = req.body || req.app.locals.invoiceData;

      if (!invoiceData) {
          return res.status(400).send('Invoice data is required');
      }

      // Render the template with the provided data
      const compiledHtml = template(invoiceData);
      await page.setContent(compiledHtml, { waitUntil: 'networkidle0' });

      // Generate a PDF buffer
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

      // Close the Puppeteer browser
      await browser.close();

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');
      res.send(pdfBuffer);
  } catch (error) {
      console.error('Error generating invoice PDF:', error);
      res.status(500).send('Internal Server Error');
  }
};

// Function to process payment asynchronously
const processPayment = async (paymentMethod, phone, email, bookingNo, totalAmount) => {
  try {
      // Determine the correct payment method
      let paymentResponse;

      const paymentData = {
          phone_number: phone,
          amount: totalAmount,
          currency: "KES",
          api_ref: bookingNo, // Use bookingNo as a reference
          redirectUrl: "https://www.launit.com/api/payments/callback",
      };

      console.log("Payment Data:", paymentData); // Log payment data

      if (paymentMethod === "mpesa") {
          paymentResponse = await collection.mpesaStkPush(paymentData);
      } else if (paymentMethod === "bank") {
          paymentResponse = await collection.charge(paymentData);
      } else if (paymentMethod === "google_pay") {
          paymentResponse = await collection.charge({
              ...paymentData,
              email: email,
          });
      } else if (paymentMethod === "apple_pay") {
          paymentResponse = await collection.charge(paymentData);
      } else {
          throw new Error("Invalid payment method");
      }

      if (paymentResponse.errors) {
          console.error("IntaSend Errors:", paymentResponse.errors);
          return null;
      }

      console.log("Payment Response:", paymentResponse);
      return paymentResponse;
  } catch (error) {
      console.error("Payment Error:", error.response?.data || error.message);
      return null;
  }
};

exports.createBooking = async (req, res) => {
  const { clientName, phone, email, location, bookingNo, package, date, time, totalAmount, paymentMethod } = req.body;

  try {
    // 1. Parse the date and time
    const bookingDateTime = new Date(`${date}T${time}`); // Assuming 'date' is in 'YYYY-MM-DD' format and 'time' is in 'HH:mm' format
    const year = bookingDateTime.getFullYear(); // Get the year from the bookingDateTime
    const month = bookingDateTime.getMonth() + 1; // Get the month (add 1 as getMonth() returns 0-based index)
    const day = bookingDateTime.getDate(); 
    
    // 2. Call getBookableDays with year and month
    const isAvailable = await getBookableDays(auth, bookingDateTime);

    // 3. Check if specific day and any timeslot is available
    if (!isAvailable) {
      return res.status(400).json({ error: "The selected timeslot is not available." });
    }

    // 4. Generate invoice
    const invoiceDetails = {
      client: {
        name: clientName,
        email: email,
        phone: phone,
        address: location,
        city: location,
        state: "KE",
        country: "KE",
        postal_code: 20100
      },
      sessionDetails: {
        type: package, // e.g., "Wedding", "Portrait", "Event"
        date: date,
        time: time,
        duration: "2 hours", // Adjust based on your service
        location: location,
        specialRequests: "None", // Modify to include any special requests
      },
      services: [
        {
          service: "Photography Session",
          description: `Photography session for ${package} on ${date} at ${time}`,
          quantity: 1,
          amount: totalAmount
        }
      ],
      subtotal: totalAmount,
      paid: 0,
      invoice_nr: bookingNo,
      paymentTerms: "Full payment required before the session.",
      cancellationPolicy: "Cancellations must be made 48 hours in advance for a full refund.",
      createdAt: new Date().toISOString(), // Timestamp for when the invoice was created
      notes: "Thank you for choosing our photography services! We look forward to capturing your special moments."
    };

    // Generate and upload invoice
    const receipt = await createInvoice(invoiceDetails, bookingNo, `invoice_${bookingNo}.pdf`);

    // 5. Send invoice via WhatsApp (optional)
    await sendWhatsAppInvoice(phone, invoiceDetails, receipt);

    // Prepare payment data for frontend
    const paymentData = {
      phone_number: phone,
      amount: totalAmount,
      currency: "KES",
      api_ref: bookingNo,
      redirectUrl: "http://localhost:5173/book/payment",
    };
    
    // 6. Generate payment checkout URL
    //const paymentResponse = { redirectUrl: response.checkout_url(paymentData) };
    
    // 7. Check payment status
    //if (!paymentResponse || !paymentResponse.success) {
    //  return res.status(400).json({ error: "Payment initiation failed." });
    //}

    // 7. Return invoice details and payment data to the frontend
    // ✅ Return payment URL and invoice details to frontend **(Do NOT finalize booking yet)**
    return res.status(200).json({
      message: "Payment required before booking confirmation",
      checkout_url: paymentResponse.redirectUrl,
      bookingNo, // Send booking number so frontend can track it
      invoiceDetails: { ...invoiceDetails, receiptUrl: receipt },
    });
  
    // 8. Await payment confirmation (you may want to implement a webhook for this)
    const paymentConfirmed = await collection.status(paymentData);
    if (!paymentConfirmed) {
        return res.status(400).json({ error: "Payment not confirmed." });
    }
  
    // 9. Create the booking in your database
    const bookingResult = await bookModel.create( name, phone, email, location, bookingNo, package, date, time, totalAmount, paymentMethod);
  
    // 10. Create a Google Calendar event
    const event = {
      summary: `Booking for ${name} - Booking #${bookingNo}`,
      description: `Booking details: ${bookingNo}, Package: ${package}`,
      start: { dateTime: bookingDateTime, timeZone: 'Africa/Nairobi' },
      end: { dateTime: new Date(bookingDateTime.getTime() + 60 * 60 * 1000), timeZone: 'Africa/Nairobi' }
    };
  
    await google.calendar({ version: 'v3', auth }).events.insert({ calendarId: 'primary', resource: event });
        
    res.status(200).json({
        message: "Booking created successfully",
        bookingId: bookingResult.bookingId,
        
        invoiceDetails: {
          ...invoiceDetails,
          receiptUrl: receipt // URL to the generated invoice
      },
      bookingNo: bookingNo // Include booking number for reference
    })
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error creating booking.");
  }
};

exports.getAllBookings = (req, res) => {
  bookModel
    .getAll((err, bookings) => {
      if (err) {
        console.error("Error getting bookings:", err);
        return res.status(500).json({ error: "Failed to get bookings" });
      }
  
      res.status(200).json(bookings);
    });
},

exports.getBookingById = (req, res) => {
  const bookingId = req.params.id;

  bookModel
    .getById(bookingId, (err, booking) => {
      if (err) {
        console.error("Error getting booking:", err);
        return res.status(500).json({ error: "Failed to get booking" });
      }
  
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
  
      res.status(200).json(booking);
    });
},


exports.getProductsByBooking = (req, res) => {
  const bookingId = req.params.id;

  Booking.getProductsByBookingId(bookingId, (err, products) => {
    if (err) {
      console.error("Error getting products for booking:", err);
      return res.status(500).json({ error: "Failed to get products" });
    }

    res.status(200).json(products);
  });
},

exports.updateBooking = (req, res) => {
  const bookingId = req.params.id;
  const updatedData = req.body;

  Booking.update(bookingId, updatedData, (err, result) => {
    if (err) {
      console.error("Error updating booking:", err);
      return res.status(500).json({ error: "Failed to update booking" });
    }

    res.status(200).json({ message: "Booking updated successfully" });
  });
},

exports.getPastBookingsByCustomerID = (req, res) => {
  const customerId = req.params.id;

  Booking.getPastBookingsByCustomerId(customerId, (err, bookings) => {
    if (err) {
      console.error("Error getting past bookings:", err);
      return res.status(500).json({ error: "Failed to get past bookings" });
    }

    res.status(200).json(bookings);
  });
},

exports.cancelBooking = (req, res) => {
  const bookingId = req.params.id;

  Booking.cancel(bookingId, (err, result) => {
    if (err) {
      console.error("Error canceling booking:", err);
      return res.status(500).json({ error: "Failed to cancel booking" });
    }

    res.status(200).json({ message: "Booking canceled successfully" });
  });
}