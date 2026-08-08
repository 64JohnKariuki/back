/**
 * @license
 * Copyright Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const { JWT } = require('google-auth-library');

const credentials = require('./credentials.json'); // Your service account key file

// If modifying these scopes, delete token.json.
const SCOPES = [ // set the right scope
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = './Utility/token.json';
const CREDENTIALS_PATH = './Utility/credentials.json';

// Load client secrets from a local file.
async function initAuthorize(callback) {
    try {
      const auth = new JWT({ // Use JWT instead of GoogleAuth
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
  
      callback(auth); 
    } catch (error) {
      console.error('Error initializing Google Calendar auth:', error);
      // Handle error appropriately
    }
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getAccessToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.dateSlots} Dateslots The OAuth2 client to get token for.
 * @param {function} callback The callback for the authorized client.
 */
async function isAvailableDate(auth, date) {
    const calendar = google.calendar({ version: 'v3', auth });

    try {
        const response = await calendar.events.list({
            calendarId: 'primary', // Or your specific calendar ID
            timeMin: startTime,
            timeMax: endTime,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items;

        // Check if any events overlap with the requested timeslot
        return events.length === 0; // Available if no events found

    } catch (error) {
        console.error('Error checking timeslot availability:', error);
        throw error; // Re-throw the error to be handled in the controller
    }
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {function} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(JWT, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', JWT);
            });
            callback(oAuth2Client);
        });
    });
}

module.exports = {
    SCOPES,
    initAuthorize
};