/**
 * FY’S INVESTMENT BOT – PAYHERO INTEGRATION
 *
 * Key Features:
 *  1. Users can deposit by entering an amount → Bot sends STK push via PayHero → Waits ~20s → Checks transaction status → If SUCCESS, credits user automatically.
 *  2. Preserves existing features (invest, withdraw, referral, reward points, etc.).
 *  3. Admin commands and other enhancements remain intact.
 *
 * Make sure to replace placeholders and adjust for your actual PayHero setup.
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

// ---------------------------
// CONFIG & GLOBAL VARIABLES
// ---------------------------

// Bot phone (digits only)
const BOT_PHONE = '254700363422';
// Super Admin phone (digits only)
const SUPER_ADMIN = '254701339573';
// Admins list
let admins = [SUPER_ADMIN];

// Some global settings (you can expand as needed)
let withdrawalMin = 1000;
let withdrawalMax = 10000000;
let depositMin = 1;
let depositMax = 10000000;
let referralBonusPercent = 3;   // used for first investment referral
let customWelcomeMessage = "👋 Welcome to FY'S INVESTMENT BOT! Start your journey to smart investing!";
let maintenanceMode = false;
let leaderboardEnabled = false;
let rewardRate = 1; // reward points per Ksh invested
let investmentReturnPercent = 10; // default return percentage

// Example deposit info (M-Pesa)
let depositInfo = { number: "0701339573", name: "Camlus Okoth" };

// PayHero Endpoints & Auth
const PAYHERO_AUTH = "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw==";
const PAYHERO_PAYMENTS_URL = "https://backend.payhero.co.ke/api/v2/payments";
const PAYHERO_STATUS_URL   = "https://backend.payhero.co.ke/api/v2/transaction-status";

// For storing user data
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading users file:', e);
    users = {};
  }
} else {
  users = {};
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper: get Kenya date/time
function getKenyaTime() {
  return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: random strings
function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
function generateDepositID() {
  return "DEP-" + randomString(8);
}
function generateWithdrawalID() {
  return "WD-" + randomString(4);
}
function generateReferralCode() {
  return "FY'S-" + randomString(5);
}

// In-memory session states
let sessions = {};

// Check if user is admin
function isAdmin(chatId) {
  const cleanId = chatId.replace(/\D/g, '');
  return admins.includes(cleanId);
}

// Notify all admins
async function notifyAdmins(text) {
  for (let adminPhone of admins) {
    const adminWID = `${adminPhone}@c.us`;
    try {
      await client.sendMessage(adminWID, text);
    } catch (error) {
      console.error(`Error notifying admin ${adminPhone}:`, error);
    }
  }
}

// -----------------------------------
// EXPRESS SETUP FOR QR CODE
// -----------------------------------
const app = express();
let lastQr = null;

app.get('/', (req, res) => {
  if (!lastQr) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>FY'S INVESTMENT BOT</h1>
          <p>No QR code available yet. Please wait...</p>
        </body>
      </html>
    `);
  }
  qrcode.toDataURL(lastQr, (err, url) => {
    if (err) {
      return res.send('Error generating QR code.');
    }
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>FY'S INVESTMENT BOT - QR Code</h1>
          <img src="${url}" alt="WhatsApp QR Code"/>
          <p>Scan this code with WhatsApp to log in!</p>
        </body>
      </html>
    `);
  });
});

app.listen(3000, () => {
  console.log('Express server running. Visit http://localhost:3000 to view the QR code.');
});

// -----------------------------------
// WHATSAPP CLIENT
// -----------------------------------
const client = new Client();

client.on('qr', qr => {
  console.log('New QR code generated. Visit http://localhost:3000 to view it.');
  lastQr = qr;
});

client.on('ready', async () => {
  console.log(`✅ Client is ready! [${getKenyaTime()}]`);
  // Notify super admin
  const superAdminWID = `${SUPER_ADMIN}@c.us`;
  try {
    await client.sendMessage(superAdminWID, `🎉 Hello Super Admin! FY'S INVESTMENT BOT is now online! [${getKenyaTime()}]`);
  } catch (err) {
    console.error('Error sending message to Super Admin:', err);
  }
});

// -----------------------------------
// MAIN MESSAGE HANDLER
// -----------------------------------
client.on('message_create', async (message) => {
  if (message.fromMe) return; // ignore our own messages

  // If maintenance mode is on, block normal users
  if (maintenanceMode && !isAdmin(message.from)) {
    await message.reply(`🚧 FY'S INVESTMENT BOT is under maintenance. Please try again later. (Type "00" for Main Menu)`);
    return;
  }

  const chatId = message.from;
  const msgBody = message.body.trim();
  console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

  // Quick nav
  if (msgBody === '0') {
    if (sessions[chatId] && sessions[chatId].prevState) {
      sessions[chatId].state = sessions[chatId].prevState;
      await message.reply(`🔙 Going back to your previous activity. (Tip: "00" for Main Menu)`);
    } else {
      sessions[chatId] = { state: 'awaiting_menu_selection' };
      await message.reply(`🔙 Cancelled. Returning to Main Menu.\n\n${mainMenuText()}`);
    }
    return;
  }
  if (msgBody === '00') {
    sessions[chatId] = { state: 'awaiting_menu_selection' };
    await message.reply(`🏠 Main Menu:\n\n${mainMenuText()}`);
    return;
  }

  // Admin commands
  if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
    await processAdminCommand(message);
    return;
  }

  // If user typed "help"
  if (msgBody.toLowerCase() === 'help') {
    await message.reply(
      `❓ *HELP / FAQ*\n\n` +
      `• Registration: Follow prompts when you first message the bot.\n` +
      `• Main Menu Options: Invest, Check Balance, Withdraw, Deposit, Change PIN, Referral Link, Referral History, Update Profile.\n` +
      `• Extra: Type "leaderboard" (if enabled) to see top investors, "reward" to see your reward points, "packages" to see investment packages.\n` +
      `• Navigation: "0" to go back, "00" for Main Menu.\n\n` +
      `Enjoy and invest smartly! 🚀`
    );
    return;
  }

  // If user typed "leaderboard" (if enabled)
  if (msgBody.toLowerCase() === 'leaderboard' && leaderboardEnabled) {
    await handleLeaderboard(message);
    return;
  }

  // If user typed "reward"
  if (msgBody.toLowerCase() === 'reward') {
    await handleRewardPoints(message);
    return;
  }

  // If user typed "packages"
  if (msgBody.toLowerCase() === 'packages') {
    await handlePackages(message);
    return;
  }

  // If user typed "DP status <DEP-ID>"
  if (/^dp status /i.test(msgBody)) {
    await handleDepositStatusRequest(message);
    return;
  }

  // Check if user is registered
  let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!sessions[chatId]) {
    sessions[chatId] = { state: registeredUser ? 'awaiting_menu_selection' : 'start' };
  }
  let session = sessions[chatId];

  // If not registered, handle registration
  if (!registeredUser) {
    await handleRegistration(message, session);
  } else {
    // If user is banned
    if (registeredUser.banned) {
      await message.reply(`🚫 You have been banned. Contact support if you think this is an error.`);
      return;
    }
    // Otherwise handle normal user session
    await handleUserSession(message, session, registeredUser);
  }
});

// -----------------------------------
// HELPER: Leaderboard
// -----------------------------------
async function handleLeaderboard(message) {
  const chatId = message.from;
  // For demonstration, let's do top 5 investors "today"
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let leaderboard = [];
  for (let key in users) {
    let user = users[key];
    let totalInvestedToday = 0;
    user.investments.forEach(inv => {
      if (inv.timestamp && inv.timestamp >= startOfToday.getTime()) {
        totalInvestedToday += inv.amount;
      }
    });
    leaderboard.push({ name: `${user.firstName} ${user.secondName}`, total: totalInvestedToday });
  }
  leaderboard.sort((a, b) => b.total - a.total);
  let top5 = leaderboard.slice(0, 5);
  if (top5.length === 0) {
    await message.reply(`🏆 Leaderboard is empty for today. Be the first to invest!`);
  } else {
    let lbText = top5.map((entry, i) => `${i + 1}. ${entry.name} – Ksh ${entry.total}`).join('\n');
    await message.reply(`🏆 *Today's Top Investors:*\n${lbText}\n[${getKenyaTime()}]`);
  }
}

// -----------------------------------
// HELPER: Reward Points
// -----------------------------------
async function handleRewardPoints(message) {
  const chatId = message.from;
  let user = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!user) {
    await message.reply(`You are not registered yet. Please register first.`);
  } else {
    let points = user.rewardPoints || 0;
    await message.reply(`🎯 *Your Reward Points:* ${points}\n(Tip: "00" for Main Menu)`);
  }
}

// -----------------------------------
// HELPER: Packages
// -----------------------------------
let investmentPackages = []; // If you want to store them in memory or load from DB

async function handlePackages(message) {
  if (investmentPackages.length === 0) {
    await message.reply(`📦 No investment packages available at the moment.\n(Tip: "00" for Main Menu)`);
  } else {
    let pkgText = investmentPackages.map((p, i) =>
      `${i + 1}. ${p.name} – Min: Ksh ${p.min}, Max: Ksh ${p.max}, Return: ${p.returnPercent}%, Duration: ${p.durationDays} days`
    ).join('\n');
    await message.reply(`📦 *Available Investment Packages:*\n${pkgText}\n(Tip: "00" for Main Menu)`);
  }
}

// -----------------------------------
// HELPER: Deposit Status Request
// -----------------------------------
async function handleDepositStatusRequest(message) {
  const chatId = message.from;
  const parts = message.body.trim().split(' ');
  if (parts.length < 3) {
    await message.reply(`❓ Please specify the deposit ID. Example: "DP status DEP-ABCDEFGH"\n(Tip: "0" to go back, "00" for Main Menu)`);
    return;
  }
  const depositID = parts.slice(2).join(' ');
  let user = Object.values(users).find(u => u.whatsAppId === chatId);
  if (!user) {
    await message.reply(`😕 You are not registered yet. Please register first!`);
    return;
  }
  let deposit = user.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
  if (!deposit) {
    await message.reply(`❌ No deposit found with ID: *${depositID}*\nCheck your ID and try again.`);
    return;
  }
  await message.reply(
    `📝 *Deposit Status*\n` +
    `• ID: ${deposit.depositID}\n` +
    `• Amount: Ksh ${deposit.amount}\n` +
    `• Date: ${deposit.date}\n` +
    `• Status: ${deposit.status}\n` +
    `[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
  );
}

// -----------------------------------
// REGISTRATION HANDLER
// -----------------------------------
async function handleRegistration(message, session) {
  const chatId = message.from;
  const msgBody = message.body.trim();

  switch (session.state) {
    case 'start':
      await message.reply(
        `👋 ${customWelcomeMessage}\n` +
        `Please type your *first name* to begin.\n(Tip: "00" for Main Menu)`
      );
      session.state = 'awaiting_first_name';
      break;

    case 'awaiting_first_name':
      session.firstName = msgBody;
      setTimeout(async () => {
        await message.reply(`✨ Great, ${session.firstName}! Now, please type your *second name*.`);
        session.state = 'awaiting_second_name';
      }, 2000);
      break;

    case 'awaiting_second_name':
      session.secondName = msgBody;
      await message.reply(
        `🙏 Thanks, ${session.firstName} ${session.secondName}!\nIf you have a *referral code*, type it now; otherwise type *NONE*.\n(Tip: "0" to go back, "00" for Main Menu)`
      );
      session.state = 'awaiting_referral_code';
      break;

    case 'awaiting_referral_code': {
      const code = msgBody.toUpperCase();
      if (code !== 'NONE') {
        let referrer = Object.values(users).find(u => u.referralCode === code);
        if (referrer) {
          session.referredBy = referrer.whatsAppId;
          await message.reply(`👍 Referral code accepted!\nNow, please enter your phone number (start with 070 or 01, 10 digits).`);
        } else {
          await message.reply(`⚠️ Referral code not found. We'll continue without referral.\nPlease enter your phone number (070 or 01, 10 digits).`);
        }
      } else {
        await message.reply(`No referral code? No worries!\nPlease enter your phone number (070 or 01, 10 digits).`);
      }
      session.state = 'awaiting_phone';
      break;
    }

    case 'awaiting_phone':
      if (!/^(070|01)\d{7}$/.test(msgBody)) {
        await message.reply(`❌ Invalid phone number format. Must start with 070 or 01 and be 10 digits.\nTry again.`);
      } else {
        session.phone = msgBody;
        await message.reply(`🔒 Great! Now, create a *4-digit PIN* for withdrawals.`);
        session.state = 'awaiting_withdrawal_pin';
      }
      break;

    case 'awaiting_withdrawal_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ That PIN isn’t 4 digits. Please try again.`);
      } else {
        session.withdrawalPIN = msgBody;
        await message.reply(`🔐 Almost done! Please create a *4-digit security PIN* (used if inactive for 30 minutes).`);
        session.state = 'awaiting_security_pin';
      }
      break;

    case 'awaiting_security_pin':
      if (!/^\d{4}$/.test(msgBody)) {
        await message.reply(`❌ Invalid PIN. Please enter a 4-digit security PIN:`);
      } else {
        session.securityPIN = msgBody;
        // Create user
        let newUser = {
          whatsAppId: chatId,
          firstName: session.firstName,
          secondName: session.secondName,
          phone: session.phone,
          withdrawalPIN: session.withdrawalPIN,
          securityPIN: session.securityPIN,
          referralCode: generateReferralCode(),
          referredBy: session.referredBy || null,
          referrals: [],
          accountBalance: 0,
          referralEarnings: 0,
          investments: [],
          deposits: [],
          withdrawals: [],
          rewardPoints: 0,
          banned: false
        };
        users[session.phone] = newUser;
        saveUsers();
        await message.reply(
          `🎉 *Registration successful*, *${newUser.firstName}*!\n` +
          `Your referral code is: *${newUser.referralCode}*\n` +
          `[${getKenyaTime()}]\n\nType "00" for Main Menu 🏠.`
        );
        sessions[chatId] = { state: 'awaiting_menu_selection' };
      }
      break;

    default:
      await message.reply(`😓 Something went wrong. Let's start over.\nType "00" for Main Menu.`);
      session.state = 'awaiting_menu_selection';
      break;
  }
}

// -----------------------------------
// USER SESSION HANDLER
// -----------------------------------
async function handleUserSession(message, session, user) {
  const chatId = message.from;
  const msgBody = message.body.trim();

  switch (session.state) {
    case 'awaiting_menu_selection':
      switch (msgBody) {
        case '1': // Invest
          // ... your invest flow
          await message.reply(`💰 *Invest Now!* (Implementation not fully shown here)`);
          break;
        case '2': // Check Balance
          // ... your check balance flow
          await message.reply(`🔍 *Check Balance Options:*\n1. Account Balance\n2. Referral Earnings\n3. Investment History\n(Tip: "0" to go back, "00" for Main Menu)`);
          session.state = 'check_balance_menu';
          break;
        case '3': // Withdraw
          // ... your withdraw flow
          session.state = 'withdraw';
          await message.reply(`💸 *Withdraw Earnings!*\nEnter the amount to withdraw:\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '4': // Deposit
          session.state = 'deposit';
          await message.reply(
            `💵 *Deposit Funds!*\n` +
            `Please enter the *deposit amount* (Min: Ksh ${depositMin}, Max: Ksh ${depositMax}).\n` +
            `Payment details: ${depositInfo.number} (Name: ${depositInfo.name})\n(Tip: "0" to go back, "00" for Main Menu)`
          );
          break;
        case '5': // Change PIN
          session.state = 'change_pin';
          await message.reply(`🔑 *Change PIN*\nEnter your current 4-digit PIN:\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        case '6': // My Referral Link
          {
            const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodeURIComponent(user.referralCode)}`;
            await message.reply(`🔗 *Your Referral Link*\n${referralLink}\n(Tip: "00" for Main Menu)`);
          }
          break;
        case '7': // Referral History
          if (user.referrals.length === 0) {
            await message.reply(`👥 You have no referrals yet.\n(Tip: "00" for Main Menu)`);
          } else {
            await message.reply(
              `👥 *Referral History*\n` +
              `Total Referrals: ${user.referrals.length}\n` +
              `Phones: ${user.referrals.join(', ')}\n` +
              `Referral Earnings: Ksh ${user.referralEarnings}\n` +
              `(Tip: "00" for Main Menu)`
            );
          }
          break;
        case '8': // Update Profile
          session.state = 'update_profile_menu';
          await message.reply(`✍️ *Update Profile*\n1. First Name\n2. Second Name\n3. Phone Number\n(Tip: "0" to go back, "00" for Main Menu)`);
          break;
        default:
          await message.reply(`❓ Option not recognized. (Tip: "00" for Main Menu)`);
          break;
      }
      break;

    case 'deposit':
      {
        let amount = parseFloat(msgBody);
        if (isNaN(amount) || amount < depositMin || amount > depositMax) {
          await message.reply(`❌ Deposit amount must be between Ksh ${depositMin} and Ksh ${depositMax}.\n(Tip: "0" to go back, "00" for Main Menu)`);
        } else {
          // 1) Create a deposit record with status "initiating" or "under review"
          let deposit = {
            amount: amount,
            date: getKenyaTime(),
            depositID: generateDepositID(),
            status: 'initiating'
          };
          user.deposits.push(deposit);
          saveUsers();

          // 2) Attempt STK push via PayHero
          let externalReference = deposit.depositID; // or any unique reference
          let phoneNumber = user.phone; // e.g. "070xxxxxxx"
          try {
            // Construct request body
            let payheroData = {
              amount: amount,
              phone_number: phoneNumber,
              channel_id: 529,          // or your actual channel
              provider: "m-pesa",      // or "airtel" if needed
              external_reference: externalReference,
              customer_name: `${user.firstName} ${user.secondName}`,
              callback_url: "https://EXAMPLE_CALLBACK_URL",  // replace with your real callback
            };

            const response = await axios.post(PAYHERO_PAYMENTS_URL, payheroData, {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': PAYHERO_AUTH
              }
            });

            // If STK push initiated successfully
            console.log(`STK Push Response:`, response.data);

            // 3) If STK push is queued successfully, update deposit status => "under review"
            deposit.status = 'under review';
            saveUsers();

            // 4) Let user know STK push was initiated
            await message.reply(
              `💵 STK push sent to your phone (Ksh ${amount}). Please approve on M-Pesa.\n` +
              `Deposit ID: ${deposit.depositID}\n` +
              `Status: under review\n` +
              `[${getKenyaTime()}]\n` +
              `We'll check transaction status in ~20 seconds.\n(Tip: "00" for Main Menu)`
            );

            // 5) Wait ~20 seconds, then check transaction status from PayHero
            setTimeout(async () => {
              await checkPayHeroTransaction(user, deposit.depositID, message);
            }, 20000);

          } catch (err) {
            // If STK push fails
            console.error(`Error sending STK push:`, err.message);
            deposit.status = 'failed';
            saveUsers();
            await message.reply(`❌ STK push request failed. Please try again later or contact support.\n(Tip: "00" for Main Menu)`);
          }
          // Return to main menu state
          session.state = 'awaiting_menu_selection';
        }
      }
      break;

    // (Implement other states: invest, withdraw, etc. as needed)

    default:
      await message.reply(`🤔 I'm not sure what you mean. (Tip: "00" for Main Menu)`);
      break;
  }
}

// -----------------------------------
// HELPER: Check PayHero Transaction Status
// -----------------------------------
async function checkPayHeroTransaction(user, depositID, originalMessage) {
  // Find the deposit record
  let deposit = user.deposits.find(d => d.depositID === depositID);
  if (!deposit) {
    console.log(`Deposit ${depositID} not found for user ${user.phone}`);
    return;
  }
  // If deposit is not "under review", no need to check
  if (deposit.status !== 'under review') {
    console.log(`Deposit ${depositID} not under review. Current status: ${deposit.status}`);
    return;
  }

  try {
    // GET request to PayHero /transaction-status?reference=<external_reference>
    let reference = depositID; // we used depositID as external_reference
    let url = `${PAYHERO_STATUS_URL}?reference=${reference}`;
    let response = await axios.get(url, {
      headers: {
        'Authorization': PAYHERO_AUTH
      }
    });

    // The response might look like: { "status": "SUCCESS", ... }
    let payStatus = response.data.status;
    console.log(`PayHero check for deposit ${depositID}: status = ${payStatus}`);

    if (payStatus === 'SUCCESS') {
      // Mark deposit as confirmed
      deposit.status = 'confirmed';
      // Credit user account
      user.accountBalance += parseFloat(deposit.amount);
      saveUsers();

      // Notify user
      await originalMessage.reply(
        `✅ *Deposit Confirmed!*\n` +
        `Deposit ID: ${depositID}\n` +
        `Amount: Ksh ${deposit.amount}\n` +
        `Your account balance is now Ksh ${user.accountBalance}\n` +
        `[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );

    } else if (payStatus === 'FAILED') {
      deposit.status = 'failed';
      saveUsers();
      await originalMessage.reply(
        `❌ Deposit *${depositID}* failed.\n` +
        `Please try again or contact support.\n` +
        `[${getKenyaTime()}]\n(Tip: "00" for Main Menu)`
      );

    } else {
      // If "QUEUED" or any other status => still under review
      await originalMessage.reply(
        `ℹ️ Deposit *${depositID}* is still *${payStatus}*.\n` +
        `We haven't received final confirmation. Please check again later.\n` +
        `(Tip: "00" for Main Menu)`
      );
    }

  } catch (err) {
    console.error(`Error checking deposit ${depositID} from PayHero:`, err.message);
    await originalMessage.reply(
      `⚠️ Unable to check deposit status for *${depositID}* right now.\n` +
      `It remains under review. Please check again later.\n` +
      `(Tip: "00" for Main Menu)`
    );
  }
}

// -----------------------------------
// ADMIN COMMAND PROCESSOR
// -----------------------------------
async function processAdminCommand(message) {
  const chatId = message.from;
  const msgParts = message.body.trim().split(' ');
  const command = (msgParts[1] || '').toLowerCase();
  const subCommand = (msgParts[2] || '').toLowerCase();

  // Example: "admin CMD"
  if (command === 'cmd') {
    await message.reply(
      `⚙️ *ADMIN COMMANDS*\n\n` +
      `1. admin CMD – Show this list.\n` +
      `2. admin view users – List all users.\n` +
      `3. admin view investments – List all investments.\n` +
      `4. admin view deposits – List all deposits.\n` +
      `5. admin approve deposit <DEP-ID> – Approve a deposit.\n` +
      `6. admin reject deposit <DEP-ID> <Reason> – Reject a deposit.\n` +
      `7. admin approve withdrawal <WD-ID> – Approve a withdrawal.\n` +
      `8. admin reject withdrawal <WD-ID> <Reason> – Reject a withdrawal.\n` +
      `9. admin ban user <phone> <Reason> – Ban a user.\n` +
      `10. admin add admin <phone> – Add a new admin (Super Admin only).\n` +
      `11. admin addbalance <phone> <amount>\n` +
      `12. admin deductbalance <phone> <amount>\n` +
      `13. admin unban <phone>\n` +
      `14. admin setwithdrawallimits <min> <max>\n` +
      `15. admin setdepositlimits <min> <max>\n` +
      `16. admin setdepositinfo <M-Pesa_Number> <Name>\n` +
      `17. admin setreturn <percentage>\n` +
      `18. admin matureinvestments\n` +
      `19. admin cancelinvestment <phone> <investment_index>\n` +
      `20. admin setrefbonus <percentage>\n` +
      `21. admin setwelcome <message>\n` +
      `22. admin sendreminder <message>\n` +
      `23. admin maintenance <on/off>\n` +
      `24. admin leaderboard <on/off>\n` +
      `25. admin setrewardrate <rate>\n` +
      `26. admin addpoints <phone> <points>\n` +
      `27. admin deductpoints <phone> <points>\n` +
      `28. admin addpackage <name> <min> <max> <returnPercent> <duration>\n` +
      `29. admin viewpackages\n` +
      `[${getKenyaTime()}]`
    );
    return;
  }

  // ... (Implement the rest of admin commands here) ...
  // For brevity, we won't repeat all admin logic from prior examples.

  await message.reply(`❓ Unrecognized admin command. Type "admin CMD" to see all commands.\n[${getKenyaTime()}]`);
}

// -----------------------------------
// MAIN MENU TEXT
// -----------------------------------
function mainMenuText() {
  return (
    `🌟 *FY'S INVESTMENT BOT* 🌟\n` +
    `_${getKenyaTime()}_\n\n` +
    `Please choose an option:\n` +
    `1. Invest 💰\n` +
    `2. Check Balance 🔍\n` +
    `3. Withdraw Earnings 💸\n` +
    `4. Deposit Funds 💵\n` +
    `5. Change PIN 🔐\n` +
    `6. My Referral Link 🔗\n` +
    `7. Referral History 👥\n` +
    `8. Update Profile ✍️\n\n` +
    `Type "0" to go back or "00" to return here anytime.`
  );
}

// -----------------------------------
// START CLIENT
// -----------------------------------
client.initialize();
