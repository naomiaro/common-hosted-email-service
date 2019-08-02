const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

// Top level
app.get('/', (req, res) => {
  res.send('ok')
})

app.post('/message', async (req, res, next) => {
  try {

    console.log("POSTED message");

    const recips = req.body.recipients.join(", ");
    const sender = '"Common Service Showcase 🦜" <NR.CommonServiceShowcase@gov.bc.ca>';

    if (req.body.devMode) {
      // Generate test SMTP service account from ethereal.email
      // Only needed if you don't have a real mail account for testing
      let testAccount = await nodemailer.createTestAccount();
      console.log(testAccount.user);
      console.log(testAccount.pass);
      console.log(testAccount.smtp.host);
      console.log(testAccount.smtp.port);
      console.log(testAccount.smtp.secure);

      // create reusable transporter object using the default SMTP transport
      let transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
        // host: "apps.smtp.gov.bc.ca"
      });

      // send mail with defined transport object
      let info = await transporter.sendMail({
        from: sender, // sender address
        to: recips, // list of receivers
        subject: req.body.subject, // Subject line
        text: req.body.text, // plain text body
        html: req.body.html
      });

      console.log("Message sent: %s", info.messageId);
      // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

      // Preview only available when sending through an Ethereal account
      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
      // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
    } else {
      // Use the bc gov smtp server
      let transporter = nodemailer.createTransport({
        host: "apps.smtp.gov.bc.ca",
        port: 25
      });

      // send mail with defined transport object
      let info = await transporter.sendMail({
        from: sender, // sender address
        to: recips, // list of receivers
        subject: req.body.subject, // Subject line
        text: req.body.text, // plain text body
        html: req.body.html
      });

      console.log(info);

    }

  } catch (error) {
    console.log(error)
  }
})

// Handle 500
app.use((err, _req, res, next) => {
  console.log(err.stack);
  res.status(500).json({
    status: 500,
    message: 'Internal Server Error: ' + err.stack.split('\n', 1)[0]
  });
  next();
});

// Handle 404
app.use((_req, res) => {
  res.status(404).json({
    status: 404,
    message: 'Page Not Found'
  });
});

app.listen(3000, () => {
  console.log("server started on port 3000")
})