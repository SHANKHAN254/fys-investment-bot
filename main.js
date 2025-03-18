/**
 * FY'S INVESTMENT BOT
 *
 * Key Points:
 *  1. Displays QR code via a simple Express web page (http://localhost:3000).
 *  2. Notifies admins on deposits, withdrawals, and investments.
 *  3. Generates a WhatsApp referral link of the form:
 *     https://wa.me/<BOT_PHONE>?text=REF<REFERRAL_CODE>
 *  4. Uses 'qrcode' (not 'qrcode-terminal') to generate QR images for the webpage.
 *  5. Fixes common errors like missing packages or port conflicts.
 *
 * Super Admin: +254701339573
 */

const { Client } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');

// -----------------------------------
// CONFIG & GLOBALS
// -----------------------------------

// 1) The BOT_PHONE is the number the bot uses (without plus sign).
//    Example: If your bot’s phone is +254700363422 in WhatsApp, use "254700363422".
const BOT_PHONE = '254700363422'; 

// 2) Super Admin phone (digits only, no plus sign).
const SUPER_ADMIN = '254701339573';

// 3) Admin list (starts with Super Admin).
let admins = [SUPER_ADMIN];

// 4) Where we store user data
const USERS_FILE = path.join(__dirname, 'users.json');

// In-memory session states
let sessions = {};

// 5) Load or create user database
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

// Save function
function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Helper: get Kenya date/time nicely
function getKenyaTime() {
    return new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
}

// Helper: random string
function randomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate referral code: e.g. "FY'S-XXXXX"
function generateReferralCode() {
    return "FY'S-" + randomString(5);
}

// Generate deposit ID: e.g. "DEP-XXXXXXXX"
function generateDepositID() {
    return "DEP-" + randomString(8);
}

// Generate withdrawal ID: e.g. "WD-XXXX"
function generateWithdrawalID() {
    return "WD-" + randomString(4);
}

// Check if phone is admin
function isAdmin(chatId) {
    let cleanId = chatId.replace(/\D/g, '');
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
// EXPRESS SERVER FOR QR CODE
// -----------------------------------
const app = express();
let lastQr = null;

app.get('/', (req, res) => {
    if (!lastQr) {
        return res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h1>FY'S INVESTMENT BOT</h1>
                    <p>No QR code available yet. Please wait for the bot to generate one...</p>
                </body>
            </html>
        `);
    }
    // Convert stored QR to a Data URL
    qrcode.toDataURL(lastQr, (err, url) => {
        if (err) {
            return res.send('Error generating QR code.');
        }
        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h1>FY'S INVESTMENT BOT - QR Code</h1>
                    <img src="${url}" alt="WhatsApp QR Code"/>
                    <p>Scan this code with your WhatsApp to log in!</p>
                </body>
            </html>
        `);
    });
});

app.listen(3000, () => {
    console.log('Express server running. Go to http://localhost:3000 to see the QR code.');
});

// -----------------------------------
// WHATSAPP CLIENT
// -----------------------------------
const client = new Client();

// On QR, store it so the webpage can display it
client.on('qr', (qr) => {
    console.log('New QR code generated. Open http://localhost:3000 to view it.');
    lastQr = qr;
});

// On ready, send a message to Super Admin
client.on('ready', async () => {
    console.log(`✅ Client is ready! [${getKenyaTime()}]`);
    const superAdminWID = `${SUPER_ADMIN}@c.us`;
    try {
        await client.sendMessage(
            superAdminWID,
            `Hello Super Admin! 🎉\nFY'S INVESTMENT BOT is now connected.\n[${getKenyaTime()}]`
        );
    } catch (error) {
        console.error('Error sending message to Super Admin:', error);
    }
});

// -----------------------------------
// MESSAGE HANDLER
// -----------------------------------
client.on('message_create', async (message) => {
    // Ignore our own messages
    if (message.fromMe) return;

    const chatId = message.from;
    const msgBody = message.body.trim();

    console.log(`[${getKenyaTime()}] Message from ${chatId}: ${msgBody}`);

    // "DP status <DEP-ID>" => check deposit status
    if (/^dp status /i.test(msgBody)) {
        await handleDepositStatusRequest(message);
        return;
    }

    // Quick navigation
    if (msgBody === '00') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🏠 *Returning to Main Menu*\n\n${mainMenuText(chatId)}`);
        return;
    } else if (msgBody === '0') {
        sessions[chatId] = { state: 'main_menu' };
        await message.reply(`🔙 *Going back to Main Menu*\n\n${mainMenuText(chatId)}`);
        return;
    }

    // Admin commands
    if (msgBody.toLowerCase().startsWith('admin') && isAdmin(chatId)) {
        await processAdminCommand(message);
        return;
    }

    // Check if user is registered
    let registeredUser = Object.values(users).find(u => u.whatsAppId === chatId);
    if (!sessions[chatId]) {
        sessions[chatId] = { state: registeredUser ? 'main_menu' : 'start' };
    }
    let session = sessions[chatId];

    if (!registeredUser) {
        // Registration flow
        await handleRegistration(message, session);
    } else {
        // If banned
        if (registeredUser.banned) {
            await message.reply(`🚫 You have been banned from using this service.`);
            return;
        }
        // Otherwise, handle user session
        await handleUserSession(message, session, registeredUser);
    }
});

// -----------------------------------
// DEPOSIT STATUS HANDLER
// -----------------------------------
async function handleDepositStatusRequest(message) {
    const chatId = message.from;
    const msgBody = message.body.trim();
    const parts = msgBody.split(' ');
    if (parts.length < 3) {
        await message.reply(`❓ Please specify the deposit ID. Example: *DP status DEP-ABCDEFGH*`);
        return;
    }
    const depositID = parts.slice(2).join(' ');

    // Find user
    let user = Object.values(users).find(u => u.whatsAppId === chatId);
    if (!user) {
        await message.reply(`You are not registered yet. Please register first.`);
        return;
    }

    let deposit = user.deposits.find(d => d.depositID.toLowerCase() === depositID.toLowerCase());
    if (!deposit) {
        await message.reply(
            `❌ No deposit found with ID: *${depositID}*\n` +
            `Check your deposit ID and try again.`
        );
        return;
    }

    await message.reply(
        `📝 *Deposit Status*\n` +
        `• Deposit ID: ${deposit.depositID}\n` +
        `• Amount: Ksh ${deposit.amount}\n` +
        `• Date: ${deposit.date}\n` +
        `• Status: ${deposit.status}\n\n` +
        `[${getKenyaTime()}]`
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
                `👋 Hello! Welcome to *FY'S INVESTMENT BOT* 😊\n\n` +
                `Please enter your *first name* to continue.`
            );
            session.state = 'awaiting_first_name';
            break;

        case 'awaiting_first_name':
            session.firstName = msgBody;
            setTimeout(async () => {
                await message.reply(
                    `Great, *${session.firstName}*!\nNow, please enter your *second name*:`
                );
                session.state = 'awaiting_second_name';
            }, 2000);
            break;

        case 'awaiting_second_name':
            session.secondName = msgBody;
            await message.reply(
                `Thanks, *${session.firstName} ${session.secondName}*!\n\n` +
                `If you have a *referral code*, type it now. Otherwise type *NONE*.`
            );
            session.state = 'awaiting_referral_code';
            break;

        case 'awaiting_referral_code': {
            const code = msgBody.toUpperCase();
            if (code !== 'NONE') {
                let referrer = Object.values(users).find(u => u.referralCode === code);
                if (referrer) {
                    session.referredBy = referrer.whatsAppId;
                    await message.reply(
                        `👍 *Referral code accepted!*\n\n` +
                        `Now, please enter your phone number (start with 070 or 01, 10 digits total).`
                    );
                } else {
                    await message.reply(
                        `⚠️ Referral code not found. We'll continue without a referral.\n\n` +
                        `Please enter your phone number (start with 070 or 01, 10 digits total).`
                    );
                }
            } else {
                await message.reply(
                    `No referral code entered. Alright!\n\n` +
                    `Please enter your phone number (start with 070 or 01, 10 digits total).`
                );
            }
            session.state = 'awaiting_phone';
            break;
        }

        case 'awaiting_phone':
            if (!/^(070|01)\d{7}$/.test(msgBody)) {
                await message.reply(
                    `❌ *Invalid phone number format.*\n` +
                    `It must start with 070 or 01 and be exactly 10 digits.\n\n` +
                    `Please re-enter your phone number.`
                );
            } else {
                session.phone = msgBody;
                await message.reply(
                    `Now, please create a *4-digit PIN* for your withdrawals (from referral earnings).`
                );
                session.state = 'awaiting_withdrawal_pin';
            }
            break;

        case 'awaiting_withdrawal_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* PIN:`);
            } else {
                session.withdrawalPIN = msgBody;
                await message.reply(
                    `Almost done! Please create a *4-digit security PIN* (used if you're inactive for 30 minutes).`
                );
                session.state = 'awaiting_security_pin';
            }
            break;

        case 'awaiting_security_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* security PIN:`);
            } else {
                session.securityPIN = msgBody;

                // Create user
                const newUser = {
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
                    banned: false
                };
                users[session.phone] = newUser;
                saveUsers();

                await message.reply(
                    `✅ *Registration successful*, *${newUser.firstName}*!\n` +
                    `Your referral code is: *${newUser.referralCode}*\n` +
                    `[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );

                sessions[chatId] = { state: 'main_menu' };
            }
            break;

        default:
            await message.reply(`Something went wrong. Let's start over.`);
            session.state = 'start';
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
        case 'main_menu':
            await message.reply(mainMenuText(chatId));
            session.state = 'awaiting_menu_selection';
            break;

        case 'awaiting_menu_selection':
            switch (msgBody) {
                case '1': // Invest
                    session.state = 'invest';
                    await message.reply(`💰 *Enter the investment amount* (min Ksh 1,000, max Ksh 150,000):`);
                    break;
                case '2': // Check Balance
                    session.state = 'check_balance_menu';
                    await message.reply(
                        `🔍 *Check Balance* Options:\n` +
                        `1. Account Balance\n` +
                        `2. Referral Earnings\n` +
                        `3. Investment History\n\n` +
                        `Reply with 1, 2, or 3:`
                    );
                    break;
                case '3': // Withdraw
                    session.state = 'withdraw';
                    await message.reply(`💸 *Enter the amount* to withdraw (min Ksh 1,000) from referral earnings:`);
                    break;
                case '4': // Deposit
                    session.state = 'deposit';
                    await message.reply(`💵 *Enter the deposit amount*:`);
                    break;
                case '5': // Change PIN
                    session.state = 'change_pin';
                    await message.reply(`🔑 *Enter your current 4-digit PIN* to proceed:`);
                    break;
                case '6': // My Referral Link
                    // Create a WhatsApp link for the BOT_PHONE with "REF<theUserReferralCode>"
                    // E.g. https://wa.me/254700363422?text=REFFY'S-ABCDE
                    const encodedRefCode = encodeURIComponent(user.referralCode);
                    const referralLink = `https://wa.me/${BOT_PHONE}?text=REF${encodedRefCode}`;
                    await message.reply(
                        `🔗 *My Referral Link*\n\n` +
                        `Share this link with friends:\n` +
                        `${referralLink}\n\n` +
                        `When they open it, they'll start a chat with the bot and type your referral code automatically! 🎉\n\n` +
                        `[${getKenyaTime()}]\n\n` +
                        mainMenuText(chatId)
                    );
                    session.state = 'main_menu';
                    break;
                default:
                    await message.reply(
                        `❓ Invalid selection. Please choose a valid option.\n\n` +
                        mainMenuText(chatId)
                    );
                    break;
            }
            break;

        case 'invest': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount < 1000 || amount > 150000) {
                await message.reply(`❌ Invalid amount. Enter an amount between Ksh 1,000 and Ksh 150,000:`);
            } else if (user.accountBalance < amount) {
                await message.reply(
                    `⚠️ *Insufficient account balance.* (Ksh ${user.accountBalance})\n` +
                    `Please deposit funds first.\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            } else {
                session.investAmount = amount;
                session.state = 'confirm_investment';
                await message.reply(`Please enter your 4-digit PIN to confirm investing Ksh ${amount}:`);
            }
            break;
        }

        case 'confirm_investment':
            if (msgBody !== user.withdrawalPIN) {
                await message.reply(`❌ Incorrect PIN. Try again or type 0 to cancel.`);
            } else {
                user.accountBalance -= session.investAmount;
                let investment = {
                    amount: session.investAmount,
                    date: getKenyaTime(),
                    expectedReturn: (session.investAmount * 0.10).toFixed(2),
                    status: 'active'
                };
                user.investments.push(investment);

                // If first investment & user was referred, add referral bonus
                if (user.investments.length === 1 && user.referredBy) {
                    let referrer = Object.values(users).find(u => u.whatsAppId === user.referredBy);
                    if (referrer) {
                        let bonus = session.investAmount * 0.03;
                        referrer.referralEarnings += bonus;
                        referrer.referrals.push(user.phone);
                        console.log(
                            `📢 [${getKenyaTime()}] Referral bonus: ` +
                            `${referrer.firstName} earned Ksh ${bonus.toFixed(2)} from ${user.firstName}'s investment.`
                        );
                    }
                }

                saveUsers();
                await message.reply(
                    `✅ *Investment Confirmed!*\n\n` +
                    `• Amount: Ksh ${session.investAmount}\n` +
                    `• Expected Return (10% after 24hrs): Ksh ${investment.expectedReturn}\n` +
                    `• Date: ${getKenyaTime()}\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';

                // Notify Admins
                await notifyAdmins(
                    `🔔 *Investment Alert*\n` +
                    `User: ${user.firstName} ${user.secondName} (${user.phone})\n` +
                    `Invested: Ksh ${session.investAmount}\n` +
                    `[${getKenyaTime()}]`
                );
            }
            break;

        case 'check_balance_menu':
            switch (msgBody) {
                case '1':
                    await message.reply(
                        `💳 *Account Balance:* Ksh ${user.accountBalance}\n` +
                        `[${getKenyaTime()}]\n\n` +
                        mainMenuText(chatId)
                    );
                    session.state = 'main_menu';
                    break;
                case '2':
                    await message.reply(
                        `🎉 *Referral Earnings:* Ksh ${user.referralEarnings}\n` +
                        `[${getKenyaTime()}]\n\n` +
                        mainMenuText(chatId)
                    );
                    session.state = 'main_menu';
                    break;
                case '3':
                    if (user.investments.length === 0) {
                        await message.reply(
                            `📄 *You have no investments yet.*\n` +
                            `[${getKenyaTime()}]\n\n` +
                            mainMenuText(chatId)
                        );
                    } else {
                        let history = user.investments.map((inv, i) =>
                            `${i + 1}. Amount: Ksh ${inv.amount}, Return: Ksh ${inv.expectedReturn}, Date: ${inv.date}, Status: ${inv.status}`
                        ).join('\n');
                        await message.reply(
                            `📊 *Investment History:*\n` +
                            `${history}\n\n` +
                            `[${getKenyaTime()}]\n\n` +
                            mainMenuText(chatId)
                        );
                    }
                    session.state = 'main_menu';
                    break;
                default:
                    await message.reply(`❓ Invalid selection. Please choose 1, 2, or 3.`);
                    break;
            }
            break;

        case 'withdraw': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount < 1000) {
                await message.reply(`❌ Invalid amount. *Minimum withdrawal* is Ksh 1,000.`);
            } else if (user.referralEarnings < amount) {
                await message.reply(
                    `⚠️ Insufficient referral earnings (Ksh ${user.referralEarnings}).\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            } else {
                user.referralEarnings -= amount;
                let wd = {
                    amount: amount,
                    date: getKenyaTime(),
                    withdrawalID: generateWithdrawalID(),
                    status: 'pending'
                };
                user.withdrawals.push(wd);
                saveUsers();
                await message.reply(
                    `✅ *Withdrawal request received.*\n\n` +
                    `• Withdrawal ID: ${wd.withdrawalID}\n` +
                    `• Amount: Ksh ${amount}\n` +
                    `• Status: Under review\n` +
                    `[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';

                // Notify Admins
                await notifyAdmins(
                    `🔔 *Withdrawal Request*\n` +
                    `User: ${user.firstName} ${user.secondName} (${user.phone})\n` +
                    `Amount: Ksh ${amount}\n` +
                    `Withdrawal ID: ${wd.withdrawalID}\n` +
                    `[${getKenyaTime()}]`
                );
            }
            break;
        }

        case 'deposit': {
            let amount = parseFloat(msgBody);
            if (isNaN(amount) || amount <= 0) {
                await message.reply(`❌ Invalid deposit amount. Please enter a valid number:`);
            } else {
                let dep = {
                    amount: amount,
                    date: getKenyaTime(),
                    depositID: generateDepositID(),
                    status: 'under review'
                };
                user.deposits.push(dep);
                saveUsers();
                await message.reply(
                    `💵 *Deposit Request Received*\n\n` +
                    `• Deposit ID: ${dep.depositID}\n` +
                    `• Amount: Ksh ${amount}\n` +
                    `• Payment to: M-Pesa 0701339573 (Name: Camlus Okoth)\n` +
                    `• Status: Under review\n` +
                    `[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';

                // Notify Admins
                await notifyAdmins(
                    `🔔 *Deposit Request*\n` +
                    `User: ${user.firstName} ${user.secondName} (${user.phone})\n` +
                    `Amount: Ksh ${amount}\n` +
                    `Deposit ID: ${dep.depositID}\n` +
                    `[${getKenyaTime()}]`
                );
            }
            break;
        }

        case 'change_pin':
            if (msgBody !== user.withdrawalPIN) {
                await message.reply(`❌ Incorrect current PIN. Try again or type 0 to cancel.`);
            } else {
                session.state = 'new_pin';
                await message.reply(`🔑 Please enter your *new 4-digit PIN*:`);
            }
            break;

        case 'new_pin':
            if (!/^\d{4}$/.test(msgBody)) {
                await message.reply(`❌ Invalid PIN. Please enter a *4-digit* PIN:`);
            } else {
                user.withdrawalPIN = msgBody;
                saveUsers();
                await message.reply(
                    `✅ *PIN changed successfully!*\n[${getKenyaTime()}]\n\n` +
                    mainMenuText(chatId)
                );
                session.state = 'main_menu';
            }
            break;

        default:
            session.state = 'main_menu';
            await message.reply(mainMenuText(chatId));
            break;
    }
}

// -----------------------------------
// ADMIN COMMAND PROCESSOR
// -----------------------------------
async function processAdminCommand(message) {
    const chatId = message.from;
    const msgBody = message.body.trim().split(' ');
    const command = (msgBody[1] || '').toLowerCase();
    const subCommand = (msgBody[2] || '').toLowerCase();

    // admin cmd => list commands
    if (command === 'cmd') {
        await message.reply(
            `⚙️ *ADMIN COMMANDS*\n\n` +
            `1. admin CMD\n   - Show this list.\n\n` +
            `2. admin view users\n   - List all registered users.\n\n` +
            `3. admin view investments\n   - List all ongoing investments.\n\n` +
            `4. admin view deposits\n   - List all deposits.\n\n` +
            `5. admin approve deposit <DEP-ID>\n   - Approve a deposit.\n\n` +
            `6. admin reject deposit <DEP-ID> <Reason>\n   - Reject a deposit with a reason.\n\n` +
            `7. admin approve withdrawal <WD-ID>\n   - Approve a withdrawal.\n\n` +
            `8. admin reject withdrawal <WD-ID> <Reason>\n   - Reject a withdrawal with a reason.\n\n` +
            `9. admin ban user <phone> <Reason>\n   - Ban a user by phone.\n\n` +
            `10. admin add admin <phone>\n   - Add a new admin (Super Admin only).\n\n` +
            `[${getKenyaTime()}]`
        );
        return;
    }

    // admin view users
    if (command === 'view' && subCommand === 'users') {
        let userList = Object.values(users)
            .map(u => `${u.firstName} ${u.secondName} (Phone: ${u.phone})`)
            .join('\n');
        if (!userList) userList = 'No registered users.';
        await message.reply(
            `📋 *User List:*\n\n${userList}\n\n[${getKenyaTime()}]`
        );
        return;
    }

    // admin view investments
    if (command === 'view' && subCommand === 'investments') {
        let investmentsList = '';
        for (let key in users) {
            let u = users[key];
            u.investments.forEach((inv, idx) => {
                investmentsList += `${u.firstName} ${u.secondName} - Investment ${idx + 1}: Ksh ${inv.amount}, Status: ${inv.status}\n`;
            });
        }
        if (!investmentsList) investmentsList = 'No investments found.';
        await message.reply(
            `📊 *All Investments:*\n\n${investmentsList}\n[${getKenyaTime()}]`
        );
        return;
    }

    // admin view deposits
    if (command === 'view' && subCommand === 'deposits') {
        let depositsList = '';
        for (let key in users) {
            let u = users[key];
            u.deposits.forEach((dep, idx) => {
                depositsList += `${u.firstName} ${u.secondName} - Deposit ${idx + 1}: ID: ${dep.depositID}, Amount: Ksh ${dep.amount}, Status: ${dep.status}\n`;
            });
        }
        if (!depositsList) depositsList = 'No deposits found.';
        await message.reply(
            `💰 *All Deposits:*\n\n${depositsList}\n[${getKenyaTime()}]`
        );
        return;
    }

    // admin approve deposit <DEP-ID>
    if (command === 'approve' && subCommand === 'deposit') {
        const depID = msgBody[3];
        if (!depID) {
            await message.reply(`Please specify the deposit ID. Example: admin approve deposit DEP-ABCDEFGH`);
            return;
        }
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.deposits.forEach(dep => {
                if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
                    dep.status = 'approved';
                    // Add deposit to account balance
                    u.accountBalance += parseFloat(dep.amount);
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`✅ *Deposit ${depID} approved.*\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`❌ Deposit ID not found: ${depID}`);
        }
        return;
    }

    // admin reject deposit <DEP-ID> <Reason...>
    if (command === 'reject' && subCommand === 'deposit') {
        const depID = msgBody[3];
        if (!depID) {
            await message.reply(`Please specify the deposit ID. Example: admin reject deposit DEP-ABCDEFGH Reason`);
            return;
        }
        const reason = msgBody.slice(4).join(' ') || 'No reason given';
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.deposits.forEach(dep => {
                if (dep.depositID.toLowerCase() === depID.toLowerCase()) {
                    dep.status = `rejected (${reason})`;
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(
                `❌ *Deposit ${depID} rejected.*\nReason: ${reason}\n[${getKenyaTime()}]`
            );
        } else {
            await message.reply(`Deposit ID not found: ${depID}`);
        }
        return;
    }

    // admin approve withdrawal <WD-ID>
    if (command === 'approve' && subCommand === 'withdrawal') {
        const wdID = msgBody[3];
        if (!wdID) {
            await message.reply(`Please specify the withdrawal ID. Example: admin approve withdrawal WD-1234`);
            return;
        }
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
                    wd.status = 'approved';
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(`✅ *Withdrawal ${wdID} approved.*\n[${getKenyaTime()}]`);
        } else {
            await message.reply(`❌ Withdrawal ID not found: ${wdID}`);
        }
        return;
    }

    // admin reject withdrawal <WD-ID> <Reason...>
    if (command === 'reject' && subCommand === 'withdrawal') {
        const wdID = msgBody[3];
        if (!wdID) {
            await message.reply(`Please specify the withdrawal ID. Example: admin reject withdrawal WD-1234 Reason`);
            return;
        }
        const reason = msgBody.slice(4).join(' ') || 'No reason given';
        let found = false;
        for (let key in users) {
            let u = users[key];
            u.withdrawals.forEach(wd => {
                if (wd.withdrawalID.toLowerCase() === wdID.toLowerCase()) {
                    wd.status = `rejected (${reason})`;
                    found = true;
                }
            });
        }
        if (found) {
            saveUsers();
            await message.reply(
                `❌ *Withdrawal ${wdID} rejected.*\nReason: ${reason}\n[${getKenyaTime()}]`
            );
        } else {
            await message.reply(`Withdrawal ID not found: ${wdID}`);
        }
        return;
    }

    // admin ban user <phone> <Reason...>
    if (command === 'ban' && subCommand === 'user') {
        let phone = msgBody[3];
        if (!phone) {
            await message.reply(`Please specify the phone. Example: admin ban user 0701234567 reason`);
            return;
        }
        let reason = msgBody.slice(4).join(' ') || 'No reason provided';
        if (users[phone]) {
            // Do not ban super admin
            if (users[phone].whatsAppId.replace(/\D/g, '') === SUPER_ADMIN) {
                await message.reply(`🚫 You cannot ban the Super Admin.`);
                return;
            }
            users[phone].banned = true;
            saveUsers();
            await message.reply(
                `🚫 *User with phone ${phone} has been banned.*\nReason: ${reason}\n[${getKenyaTime()}]`
            );
        } else {
            await message.reply(`User with phone ${phone} not found.`);
        }
        return;
    }

    // admin add admin <phone>
    if (command === 'add' && subCommand === 'admin') {
        // Only Super Admin can add new admins
        if (chatId.replace(/\D/g, '') !== SUPER_ADMIN) {
            await message.reply(`🚫 Only the Super Admin can add new admins.`);
            return;
        }
        let newAdminPhone = msgBody[3]?.replace(/\D/g, '');
        if (!newAdminPhone) {
            await message.reply(`❌ Invalid phone number for new admin.`);
            return;
        }
        if (!admins.includes(newAdminPhone)) {
            admins.push(newAdminPhone);
            await message.reply(`✅ ${newAdminPhone} has been *added as an admin*.`);
        } else {
            await message.reply(`ℹ️ ${newAdminPhone} is already an admin.`);
        }
        return;
    }

    // If no recognized admin command
    await message.reply(
        `❓ Unrecognized admin command.\n` +
        `Type *admin CMD* to see all commands.\n` +
        `[${getKenyaTime()}]`
    );
}

// -----------------------------------
// MAIN MENU HELPER
// -----------------------------------
function mainMenuText(chatId) {
    return (
        `🌟 *FY'S INVESTMENT BOT* 🌟\n` +
        `_${getKenyaTime()}_\n\n` +
        `Please select an option:\n` +
        `1. Invest 💰\n` +
        `2. Check Balance 🔍\n` +
        `3. Withdraw Earnings 💸\n` +
        `4. Deposit Funds 💵\n` +
        `5. Change PIN 🔑\n` +
        `6. My Referral Link 🔗\n\n` +
        `Type *00* for Main Menu or *0* to go back.`
    );
}

// -----------------------------------
// START THE CLIENT
// -----------------------------------
client.initialize();
