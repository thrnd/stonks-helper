const { app, BrowserWindow, ipcMain } = require("electron");
const electronLiveReload = require('electron-reload');
const { performance } = require('perf_hooks');
const fs = require("fs");
const trimValue = require("./src/js/helpers/trim-value.js");
const toLower = require("./src/js/helpers/to-lower.js");
const validatePrice = require("./src/js/helpers/price-validator.js");
const XLSX = require("./src/js/libs/xlsx.full.js");

electronLiveReload(__dirname, {
    electron: require(`${__dirname}/node_modules/electron`),
    ignored: /node_modules|[\/\\]\.|out/,
});

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 800,
        minHeight: 600,
        icon: "./src/img/stonks-32.png",
        webPreferences: {
            nodeIntegration: true,
            nodeIntegrationInWorker: true,
            contextIsolation: false,
        },
        webgl: true,
        defaultEncoding: true,
        navigateOnDragDrop: false,
    });

    win.loadFile("./src/index.html");
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle("changePrices", (event, { workbook, targetData, targetHash, targetPriceCol, sourceFiles }) => {
    const dataForManualHandling = {};
    const missingPositions = {};
    const foundSKUs = {};

    const start = performance.now();
    for (const fileName in sourceFiles) {
        const sheets = sourceFiles[fileName];

        for (const sheetIndex in sheets) {
            const { data, _skuCol, _priceCol, name: sheetName } = sheets[sheetIndex];

            data.forEach((row, rowIndex) => {
                const rawSKU = row[_skuCol];
                const sku = toLower( trimValue(rawSKU) );

                if (!sku) return;

                const price = trimValue(row[_priceCol]);
                const isPriceValid = validatePrice(price);

                if (isPriceValid === false) return;

                const sourceDataInfo = {
                    fileName,
                    sheetIndex,
                    sheetName,
                    rowIndex,
                    sku: rawSKU,
                    price,
                };

                // TODO вынести в функцию
                if (sku in targetHash) {
                    const targetObj = targetHash[sku];
                    const wasMarkedPreviously = targetObj.isMarkedForManualHandling;
                    let targetArray = null;

                    if (isPriceValid === "maybe") {
                        dataForManualHandling[fileName] ||= {};
                        dataForManualHandling[fileName][sku] ||= [];

                        targetArray = dataForManualHandling[fileName][sku];
                        targetObj.isMarkedForManualHandling = true;

                        if (!wasMarkedPreviously && targetObj.matches?.length > 0) {
                            targetArray = targetArray.concat(targetObj.matches);
                            delete targetObj.matches;
                        }
                    }
                    else if (wasMarkedPreviously) {
                        targetArray = dataForManualHandling[fileName][sku];
                    }
                    else {
                        targetObj.matches ||= [];
                        targetArray = targetObj.matches;
                    }

                    targetArray.push(sourceDataInfo);
                }
                else {
                    let possibleSKUs = null;

                    if (typeof sku === "string") {
                        possibleSKUs = sku
                            .split(",")
                            .map(sku => toLower( trimValue(sku) ));
                    }

                    if (possibleSKUs !== null) {
                        possibleSKUs.forEach(possibleSKU => {
                            // TODO вынести в функцию
                            if (possibleSKU in targetHash) {
                                foundSKUs[possibleSKU] ||= [];
                                foundSKUs[possibleSKU].push(sourceDataInfo);

                                const targetObj = targetHash[possibleSKU];
                                const wasMarkedPreviously = targetObj.isMarkedForManualHandling;
                                let targetArray = null;

                                if (isPriceValid === "maybe") {
                                    dataForManualHandling[fileName] ||= {};
                                    dataForManualHandling[fileName][sku] ||= [];

                                    targetArray = dataForManualHandling[fileName][sku];
                                    targetObj.isMarkedForManualHandling = true;

                                    if (!wasMarkedPreviously && targetObj.matches?.length > 0) {
                                        targetArray = targetArray.concat(targetObj.matches);
                                        delete targetObj.matches;
                                    }
                                }
                                else if (wasMarkedPreviously) {
                                    targetArray = dataForManualHandling[fileName][sku];
                                }
                                else {
                                    targetObj.matches ||= [];
                                    targetArray = targetObj.matches;
                                }

                                targetArray.push(sourceDataInfo);
                            }
                        });
                    }

                    missingPositions[fileName] ||= {};
                    missingPositions[fileName][sku] ||= [];
                    missingPositions[fileName][sku].push(sourceDataInfo);
                }
            });
        }
    }

    let updatedCount = 0;

    targetData.forEach(({ sku }) => {
        if (!sku) return;

        const targetObj = targetHash[sku];
        const { wasUpdated, isMarkedForManualHandling, matches, rows } = targetObj;

        if (wasUpdated || isMarkedForManualHandling || !isMarkedForManualHandling && matches === undefined) return;

        let isAllPricesEqual = true;
        const { price } = matches[0];

        for (let i = 1; isAllPricesEqual && i < matches.length; i++) {
            const { price: currentPrice } = matches[i];
            isAllPricesEqual = price === currentPrice;
        }

        if (!isAllPricesEqual) {
            dataForManualHandling[ matches[0].fileName ] ||= {};
            dataForManualHandling[ matches[0].fileName ][sku] = [...matches];
            targetObj.isMarkedForManualHandling = true;
            delete targetObj.matches;

            return;
        }

        rows.forEach(rowIndex => {
            targetData[rowIndex].row[targetPriceCol] = price;
            updatedCount++;
        });
        targetObj.wasUpdated = true;
    });

    const sheetData = XLSX.utils.json_to_sheet( targetData.map(({ row }) => row), {
        skipHeader: true
    });

    workbook.Sheets = {
        [ workbook.SheetNames[0] ]: sheetData
    };

    XLSX.writeFile(workbook, "./out/out.csv", {
        bookType: "csv",
        type: "string",
        FS: "^",
        strip: true,
    });

    return {
        time: performance.now() - start,
        missingPositions,
        dataForManualHandling,
        targetData,
        updatedCount,
    };
});

function humanReadReport(original) {
    let result = "";

    for (const fileName in original) {
        const fileData = original[fileName];

        result += `Файл - ${fileName}\n\t`;

        for (const sku in fileData) {
            const sourceDataArray = fileData[sku];

            sourceDataArray.forEach(sourceDataInfo => {
                const { rowIndex, price } = sourceDataInfo;

                result += `SKU - ${sku}\n\t\tЦена - ${price}\n\t\tСтрока - ${rowIndex + 1}\n\t`;
            });
        }
    }

    return result;
}

function humanReadMH(original) {
    let result = "";

    for (const fileName in original) {
        const fileData = original[fileName];

        result += `Файл - ${fileName}\n\t`;

        for (const sku in fileData) {
            const sourceDataArray = fileData[sku];

            result += `SKU - ${sku}\n\t`;

            sourceDataArray.forEach(sourceDataInfo => {
                const { rowIndex, price } = sourceDataInfo;

                result += `\tЦена - ${price}\n\t\tСтрока - ${rowIndex + 1}\n\n\t`;
            });
        }
    }

    return result;
}