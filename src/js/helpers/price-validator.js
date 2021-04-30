module.exports = (price) => {
    const type = typeof price;
    const isNum = type === "number";
    const isStr = type === "string";
    const priceNum = isStr ? parseFloat(price) : null;
    const canBeParsedAsNumber = priceNum !== null && isNaN(priceNum) === false;

    if (!isNum && !price || isStr && !canBeParsedAsNumber) return false;

    if (isStr && canBeParsedAsNumber) return "maybe";

    return true;
}
