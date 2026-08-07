import dotenv from "dotenv";
import path from "path";

// Load .env file for tests
dotenv.config({
  path: path.resolve(import.meta.dirname, ".env"),
});
