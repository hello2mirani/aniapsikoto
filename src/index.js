const app = require("./app");

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`aniapikoto listening on http://localhost:${PORT}`);
});
