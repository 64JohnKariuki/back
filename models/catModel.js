// cartModel.js

const pool = require("../config/db");

exports.getCategories("/categories", (req, res) => {
    return new Promise((resolve, reject) => {
        res.send(categories);
        (err, result) => {
            if (err) {
              reject(err);
            } else {
              resolve(result);
            }
        }
    });
});
  
exports.getCatById("/categories/:id", (req, res) => {
    const id = req.params.id;
    const matchedProducts = products?.filter((item) => item?._base === id);
  
    if (!matchedProducts || matchedProducts.length === 0) {
      return res
        .status(404)
        .json({ message: "No products matched with this category" });
    }
    res.json(matchedProducts);
});