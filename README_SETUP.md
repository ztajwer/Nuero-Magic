# NeuroMagic Setup Guide 🚀

To get everything working perfectly with your local XAMPP environment, please follow these steps:

## 1. Database Setup (PHPMyAdmin)
1. Open **XAMPP Control Panel** and start **Apache** and **MySQL**.
2. Go to [http://localhost/phpmyadmin](http://localhost/phpmyadmin).
3. Click on the **SQL** tab at the top.
4. Open the `database_migration.sql` file in this folder, copy all its content, and paste it into the PHPMyAdmin SQL box.
5. Click **Go**. This will create the `neuromagic` database and all necessary tables with the correct columns.

## 2. Environment Configuration
- Ensure your `.env` file has the correct database credentials.
- The current `.env` is already configured for the default XAMPP setup:
  ```env
  DB_HOST=localhost
  DB_USER=root
  DB_PASSWORD=
  DB_NAME=neuromagic
  ```

## 3. Launching the App
1. Open your terminal in this project folder.
2. Run `npm install` (if you haven't already).
3. Run `npm start`.
4. Visit [http://localhost:3000](http://localhost:3000) in your browser.

## 4. Key terminology
- **Prompt** is now **Magic** or **Instruction**.
- **Enhance** is now **Refine** or **Personalize**.
- All UI elements support both **English** and **Urdu**.

---
*Designed for Startups & Excellence*
