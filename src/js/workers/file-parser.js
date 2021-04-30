const XLSX = require("../libs/xlsx.full.js");
// const chardet = require("chardet");

onmessage = function(event) {
    const files = event.data;
    const frSync = new FileReaderSync();

    files.forEach((fileObj, index) => {
        const { file } = fileObj;
        const { name } = file;
        const isCsv = name.match(/\.csv$/i) !== null;
        // to avoid errors with different encodings read CSV files as text
        const buffer = isCsv ? frSync.readAsText(file) : frSync.readAsArrayBuffer(file);
        const data = isCsv ? buffer : new Uint8Array(buffer);
        let workbook = null;

        try {
            workbook = XLSX.read(data, {
                type: isCsv ? "string" : "array",
                raw: isCsv,
                csvQuotationChar: isCsv ? "|" : "",
            });
        }
        catch(error) {
            postMessage({
                status: "error",
                file: name,
                data: error.stack,
            });

            return;
        }

        const json = toJson(workbook, name);
        const message = {
            status: "done",
            type: "file",
            data: {
                file: name,
                current: index + 1,
                total: files.length,
                data: json,
            },
        };

        if (isCsv) {
            const { Sheets, Strings, ...workbookMeta } = workbook;
            message.data.workbook = { ...workbookMeta };
        }

        postMessage(message);
    });
}

function toJson(workbook, fileName) {
    if (workbook.SSF) {
        XLSX.SSF.load_table(workbook.SSF);
    }

    const result = [];

    workbook.SheetNames.forEach((name, index) => {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
            raw: true,
            header: 1,
        });

        const __files = [];
        data.forEach((row, i) => {
            if (row.length !== 10) {
                __files.push(i)
            }
        })

        console.log(__files)

        // console.log( data );
        // console.log( Object.keys(workbook.Sheets.Sheet1) );
        // console.log(workbook.Sheets[name]['!ref']) // A1:BQF23154

        if (data.length > 0) {
            result.push({
                index,
                name,
                data,
                // __files,
                // html: XLSX.utils.sheet_to_html(workbook.Sheets[name], {
                //     raw: true,
                //     header: 1,
                // })
            });
        }

        postMessage({
            status: "done",
            type: "sheet",
            data: {
                file: fileName,
                current: index + 1,
                total: workbook.SheetNames.length,
            },
        });
    });

    return result;
}