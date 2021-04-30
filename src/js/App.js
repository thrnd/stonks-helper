const { ipcRenderer } = require("electron");
const DragNDrop = require("./Dragndrop.js");
const trimValue = require("./helpers/trim-value.js");
const toLower = require("./helpers/to-lower.js");
// const chardet = require("chardet");

module.exports = class App {
    constructor() {
        this.files = [];

        this.fileRegExp = /\.xls|xlsx|xlsm|xlsb|csv$/i;

        this.targetFileSKUCol = 4;
        this.targetFilePriceCol = 5;

        this.targetFile = null;
        this.activeSourceFile = null;

        this.worker = null;
        this.hash = null;
        this.probmelaticRows = [];

        this.confirmPromiseResolve = null;

        this.targetConfigChange = this.targetConfigChange.bind(this);
        this.sourceConfigChange = this.sourceConfigChange.bind(this);
        this.showFileConfig = this.showFileConfig.bind(this);
        this.changeBtnClickHandler = this.changeBtnClickHandler.bind(this);

        this.dnd = new DragNDrop({
            fileRegExp: this.fileRegExp,
            onDragOver: (event) => {
                let dropArea = document.querySelector(".drag-n-drop-area");

                if (dropArea === null) {
                    dropArea = document.createElement("DIV");
                    dropArea.className = "drag-n-drop-area";
                    dropArea.dataset.msg = "Да-да, сюда";
                    document.body.append(dropArea);
                }

                dropArea.classList.add("drag-n-drop-area--visible");
            },
            onDragLeave: (event) => {
                const dropArea = document.querySelector(".drag-n-drop-area");
                const { target } = event;

                if (dropArea !== null && target === dropArea) {
                    dropArea.classList.remove("drag-n-drop-area--visible");
                }
            },
            onDrop: (files) => {
                const dropArea = document.querySelector(".drag-n-drop-area");

                if (dropArea !== null) {
                    dropArea.classList.remove("drag-n-drop-area--visible");
                }

                let wasNewFilesAdded = false;

                files.forEach(file => {
                    wasNewFilesAdded = this.addFile(file) || wasNewFilesAdded;
                });

                if (!wasNewFilesAdded) return;

                this.onFileAdd();
            },
        });

        // adding files
        document.querySelector("input[type='file']")
            .addEventListener("change", (event) => {
                const { target } = event;
                let wasNewFilesAdded = false;

                for(const file of target.files) {
                    if ( !file.name.match(this.fileRegExp) ) continue;

                    wasNewFilesAdded = this.addFile(file) || wasNewFilesAdded;
                }

                target.value = "";

                if (!wasNewFilesAdded) return;

                this.onFileAdd();
            });

        // deleting file
        document.addEventListener("click", async (event) => {
            const { target } = event;

            if ( target.closest(".file__del") === null ) return;

            const file = target.closest(".file");
            const isConfirmed = await this.confirm(`Вы действительно хотите удалить файл<br><b>${file.dataset.file}</b><br>из списка?`);

            if (!isConfirmed) return;

            this.files = this.files.filter(item => item.file.name !== file.dataset.file);

            if (this.activeSourceFile?.file.name === file.dataset.file) {
                this.activeSourceFile = null;
            }
            if (this.targetFile?.file.name === file.dataset.file) {
                this.targetFile = null;
            }

            file.remove();

            this.renderFiles();
            this.renderConfig();
            this.renderFileConfig();
            this.renderChangeBtn();
        });

        // closing dialog and resolving respective promise by pressing "ESC"
        document.addEventListener("keydown", (event) => {
            const isEscapePressed = event.key === "Escape";

            if (!isEscapePressed) return;

            const dialog = document.querySelector(".dialog");
            const isConfirmPromiseSet = this.confirmPromiseResolve !== null;

            if (dialog === null || !isConfirmPromiseSet) return;

            this.resolveDialog(false, dialog);
        });

        // closing dialog and resolving respective promise by click
        document.addEventListener("click", (event) => {
            const { target } = event;
            const dialog = target.closest(".dialog");

            if (dialog === null) return;

            const isBtnClick = target.classList.contains("dialog__btn");
            const isDialogClick = target.classList.contains("dialog");
            const isCloseClick = target.classList.contains("dialog__close");
            const isClose = isDialogClick || isCloseClick;

            if (!isClose && !isBtnClick) return;

            event.preventDefault();

            const isConfirmed = !isClose && target.classList.contains("dialog__btn--t--confirm");
            this.resolveDialog(isConfirmed, dialog);
        });

        // changing target file config
        document.addEventListener("click", this.targetConfigChange);

        // show source file config
        document.addEventListener("click", this.showFileConfig);

        // changing source file config
        document.addEventListener("click", this.sourceConfigChange);

        // select/unselect all sheets
        document.addEventListener("click", (event) => {
            const { target } = event;
            const { id } = target;

            if (id !== "select-all" && id !== "unselect-all") return;

            [ ...document.querySelectorAll(".file-config-wrap input[type='checkbox']") ].forEach(checkbox => {
                checkbox.checked = id === "select-all";
                checkbox.dispatchEvent( new Event("change", { bubbles: true }) );
            });
        });

        // removing error from checkbox group
        // and toggling respective inputs for (un)selected sheet
        document.addEventListener("change", (event) => {
            const { target } = event;

            if ( !target.matches(".file-config__checkbox") ) return;

            const parent = target.closest(".file-config__checkbox-group");
            const hasError = parent.classList.contains("file-config__checkbox-group--error");

            if (hasError && target.checked) {
                parent.classList.remove("file-config__checkbox-group--error");
            }

            const sheetIndex = target.dataset.for;
            const skuInput = parent.querySelector(`.file-config__sku-input[data-for='${sheetIndex}']`);
            const priceInput = parent.querySelector(`.file-config__price-input[data-for='${sheetIndex}']`);

            skuInput.disabled = !target.checked;
            priceInput.disabled = !target.checked;
        });

        // changing prices
        document.addEventListener("click", this.changeBtnClickHandler);
    }

    addFile(file) {
        if ( this.wasFileAdded(file) ) {
            console.log(`File ${file.name} was previously added`);

            return false;
        }

        console.log(`Reading ${file.name} file...`);

        this.files.push({
            file,
            wasParsed: false,
            config: null,
        });

        return true;
    }

    wasFileAdded(file) {
        if (this.files.length === 0) return false;

        const { name, lastModified, size } = file;
        const exactSameFile = this.files.find(({ file }) => name === file.name && lastModified === file.lastModified && size === file.size );

        return exactSameFile !== undefined;
    }

    onFileAdd() {
        this.renderFiles();
        this.renderConfig();
        this.renderFileConfig();
        this.renderChangeBtn();

        if (this.worker === null) {
            this.worker = new Worker("./js/workers/file-parser.js");
            this.worker.addEventListener("message", (event) => {
                const { status, type, data } = event.data;

                if (status === "done") {
                    const isFileParsed = type === "file";
                    const progressTarget = isFileParsed ? "файлов" : "листов";

                    const parsedFile = this.files.find(fileObj => fileObj.file.name === data.file);
                    const file = document.querySelector(`.file[data-file='${data.file}']`);

                    if (isFileParsed) {
                        parsedFile.data = data.data;
                        parsedFile.wasParsed = true;
                        file.classList.add("file--parsed");

                        if ("workbook" in data) {
                            parsedFile.workbook = data.workbook;
                        }
                        // if ("__files" in data.data[0]) {
                        //     const f = [];

                        //     data.data[0].__files.forEach(index => {
                        //         f.push({
                        //             rowIndex: index + 1,
                        //             row: data.data[0].data[index]
                        //         });
                        //     })

                        //     ipcRenderer.invoke("er", f);
                        // }
                    }
                    else {
                        file.style.setProperty("--progress", `${(data.current / data.total) * 40}px`);
                    }

                    console.log(`Прочитано ${data.current} из ${data.total} ${progressTarget}.`);
                }
                else if (status === "error") {
                    const error = data;

                    console.log(error);
                    this.alert(`Ошибка парсинга файла ${event.data.file}`);
                }
            });
        }

        // parsing only files that have not beed parsed
        this.worker.postMessage(this.files.filter(fileObj => !fileObj.wasParsed));
    }

    onTargetFileParse() {
        return new Promise((resolve, reject) => {
            this._msgHandler = this.targetFileParseMessageHandler.bind(this, resolve);
            this._errorHandler = this.targetFileParseErrorHandler.bind(this, reject);

            this.worker.addEventListener("message", this._msgHandler);
            this.worker.addEventListener("error", this._errorHandler);
        });
    }

    targetFileParseMessageHandler(resolve, event) {
        const { status, type, data } = event.data;

        if (status === "done" && type === "file" && data.file === this.targetFile.file.name) {
            this.worker.removeEventListener("message", this._msgHandler);
            this.worker.removeEventListener("error", this._errorHandler);

            resolve();
        }
    }

    targetFileParseErrorHandler(reject, event) {
        const { data: error } = event.data;

        this.worker.removeEventListener("message", this.targetFileParseMessageHandler);
        this.worker.removeEventListener("error", this.targetFileParseErrorHandler);

        reject(error);
    }

    async targetConfigChange(event) {
        const { target } = event;
        const { id, form } = target;

        if (id !== "config-btn") return;

        const isValid = form.reportValidity();
        const parent = form.querySelector(".file-label");
        parent.classList.toggle("file-label--selected", isValid);

        if (!isValid) return;

        const targetSelect = document.getElementById("target-file-select");
        const { value: fileName } = targetSelect;
        const selectedFile = this.files.find(({ file }) => file.name === fileName);
        const skuInput = document.getElementById("target-sku");
        const priceInput = document.getElementById("target-price");
        const isConfirmed = await this.confirm(`Вы действительно хотите выбрать файл<br><b>${selectedFile.file.name}</b><br>в качестве файла-выгрузки?<br><br>Будут применены следующие настройки:<br>Столбец с SKU: <b>${skuInput.value}</b><br>Столбец с ценами: <b>${priceInput.value}</b>`);

        if (!isConfirmed) return;

        this.targetFileSKUCol = +skuInput.value;
        this.targetFilePriceCol = +priceInput.value;
        this.targetFile = selectedFile;
        this.targetFile.config = null;

        const currentTarget = document.querySelector(".file--t--target");
        currentTarget?.classList.remove("file--t--target");
        const file = document.querySelector(`.file[data-file='${this.targetFile.file.name}']`);
        file.classList.add("file--t--target", "file--config-saved");
        file.classList.remove("file--active");

        if (this.activeSourceFile === this.targetFile) {
            this.activeSourceFile = null;
            this.renderFileConfig();
        }

        if (!this.targetFile.wasParsed) {
            try {
                await this.onTargetFileParse();
            }
            catch (err) {
                console.error(err);
                this.alert(`Ошибка парсинга файла ${err.file}`);

                return;
            }
        }

        this.renderChangeBtn();
        this.calcHash();
    }

    calcHash() {
        this.hash = {};
        this.targetData = [];

        this.targetFile.data[0].data.forEach((row, index) => {
            const sku = toLower( trimValue(row[this.targetFileSKUCol - 1]) );

            this.targetData.push({
                sku,
                row,
            });

            if (!sku) return;

            this.hash[sku] ||= {
                rows: [],
            };
            this.hash[sku].rows.push(index);
        });
    }

    renderFiles() {
        let files = document.querySelector(".files");

        if (files === null) {
            files = document.createElement("DIV");
            files.className = "field files";

            const parent = document.querySelector(".files-wrap");
            parent.append(files);
        }

        if (this.files.length === 0) {
            return files.remove();
        }

        files.innerHTML = `
            <div class="field__title">Выбранные файлы</div>
            <div class="field__inner">
                ${
                    this.files
                        .map(fileObj => {
                            const { name } = fileObj.file;
                            const { wasParsed, config }= fileObj;
                            const tmpArr = name.split(".");
                            const ext = tmpArr[tmpArr.length - 1];
    
                            return `
                                <div class="file ${wasParsed ? "file--parsed": ""} ${fileObj === this.activeSourceFile ? "file--active" : ""} ${config !== null ? "file--config-saved" : ""} ${fileObj === this.targetFile ? "file--t--target" : ""}" data-file="${name}">
                                    <button class="file__del" type="button"></button>
                                    <div class="file__icon" data-ext="${ext}">
                                        <div class="file__icon-triangle"></div>
                                    </div>
                                    <div class="file__name">${name}</div>
                                    <div class="file__config" title="Настройки парсинга для файла сохранены"></div>
                                </div>
                            `;
                        })
                        .join("")
                }
            </div>
        `;

        const delBtns = [ ...files.querySelectorAll(".file__del") ];
        delBtns.forEach(btn => {
            btn.addEventListener("pointerenter", this.delBtnPointerMoveHandler);
            btn.addEventListener("pointerleave", this.delBtnPointerMoveHandler);
        });
    }

    renderConfig() {
        let config = document.querySelector(".config");

        if (config === null) {
            config = document.createElement("FORM");
            config.className = "config";

            const parent = document.querySelector(".config-wrap");
            parent.append(config);
        }

        if (this.files.length === 0) {
            return config.remove();
        }

        config.innerHTML = `
            <div class="file-label ${this.targetFile !== null ? "file-label--selected" : ""}">
                <label class="label">
                    <select class="select" id="target-file-select" required>
                        <option value="">Выберите файл выгрузки</option>
                        ${
                            this.files
                                .map(fileObj => {
                                    const { name } = fileObj.file;
                                    const tmpArr = name.split(".");
                                    const ext = tmpArr[tmpArr.length - 1];
    
                                    return `
                                        <option${ext.match(/csv/i) ? ' class="select__csv"': ""} value="${name}" ${fileObj === this.targetFile ? "selected" : ""}>${name}</option>
                                    `;
                                })
                                .join("")
                        }
                    </select>
                    <span class="label__text">Файл выгрузки</span>
                </label>
                <div class="file-label__inner">
                    <label class="label file-label__item">
                        <input class="input label__input" id="target-sku" type="number" value="${this.targetFileSKUCol}" min="1" step="1" required>
                        <span class="label__text">Столбец с SKU</span>
                    </label>
                    <label class="label file-label__item">
                        <input class="input label__input" id="target-price" type="number" value="${this.targetFilePriceCol}" min="1" step="1" required>
                        <span class="label__text">Столбец с ценой</span>
                    </label>
                </div>
                <button class="btn" id="config-btn" type="button">Применить</button>
            </div>
        `;
    }

    showFileConfig(event) {
        const { target } = event;
        const file = target.closest(".file");
        const isDelBtn = target.closest(".file__del") !== null;

        if (file === null || !file.classList.contains("file--parsed") || isDelBtn) return;

        if ( file.classList.contains("file--t--target") ) {
            document.getElementById("target-sku")
                .focus();

            return;
        }

        [ ...document.querySelectorAll(".file--active") ].forEach(file => file.classList.remove("file--active"));
        file.classList.add("file--active");

        const { file: fileName } = file.dataset;
        const fileObj = this.files.find(fileObj => fileObj.file.name === fileName);

        this.activeSourceFile = fileObj;

        this.renderFileConfig();
    }

    renderFileConfig() {
        const fileObj = this.activeSourceFile;
        const fileConfig = fileObj?.config || null;
        const isConfigSet = fileConfig !== null;
        let config = document.querySelector(".file-config");

        if (config === null) {
            config = document.createElement("FORM");
            config.className = "file-config field";

            const parent = document.querySelector(".file-config-wrap");
            parent.append(config);
        }

        config.classList.toggle("file-config--active", fileObj !== null);
        config.classList.toggle("file-config--filled", isConfigSet);

        if (this.files.length === 0) {
            return config.innerHTML = "";
        }

        const isSingleSheet = fileObj?.data.length === 1;

        config.innerHTML = `
            <div class="field__title" title="Настройки парсинга файла ${ fileObj === null ? "" : fileObj.file.name}">Настройки парсинга файла ${ fileObj === null ? "" : `<b>${fileObj.file.name}</b>` }</div>
            <div class="field__inner">
                ${fileObj === null ? "Выберите файл из списка слева" : `
                    <div class="field field--t--inner">
                        <div class="field__title" title="Выберите листы для парсинга">Выберите листы для парсинга</div>
                        <button class="btn" id="select-all" type="button" ${ fileObj.data.length === 1 ? "disabled" : "" }>Выделить все</button>
                        <button class="btn" id="unselect-all" type="button" ${ fileObj.data.length === 1 ? "disabled" : "" }>Снять выделение</button>
                        <div class="field__inner file-config__checkbox-group">
                            ${
                                fileObj.data
                                    .map(sheet => {
                                        const { index, name } = sheet;
                                        const wasSavedPreviously = isConfigSet
                                            ? index in fileConfig
                                            : false;
                                        const checkboxState = `${isSingleSheet ? "checked disabled" : wasSavedPreviously ? "checked" : ""}`;
                                        const skuCol = wasSavedPreviously
                                            ? fileConfig[index].sku
                                            : 0;
                                        const priceCol = wasSavedPreviously
                                            ? fileConfig[index].price
                                            : 0;

                                        return `
                                            <div class="file-config__item">
                                                <label class="label label--t--checkbox file-config__label file-config__label--t--checkbox">
                                                    <input class="file-config__checkbox" type="checkbox" value="${index}" ${checkboxState} data-name="${name}" data-for="${index}">
                                                    <span>${name}</span>
                                                </label>
                                                <label class="label file-config__label">
                                                    <input class="input label__input file-config__sku-input" type="number" value="${skuCol}" min="1" step="1" data-for="${index}" required ${!isSingleSheet && !wasSavedPreviously ? "disabled" : ""}>
                                                    <span class="label__text file-config__label-text">Столбец с SKU</span>
                                                </label>
                                                <label class="label file-config__label">
                                                    <input class="input label__input file-config__price-input" type="number" value="${priceCol}" min="1" step="1" data-for="${index}" required ${!isSingleSheet && !wasSavedPreviously ? "disabled" : ""}>
                                                    <span class="label__text file-config__label-text">Столбец с ценой</span>
                                                </label>
                                            </div>
                                        `;
                                    })
                                    .join("")
                            }
                        </div>
                    </div>
                    <button class="btn" id="file-config-submit" type="button">Применить</button>
                `}
            </div>
        `;

        // [ ...config.querySelectorAll(".label__input") ].forEach(input => {
        //     input.setCustomValidity("A-Za-z1-0");
        // });
    }

    renderChangeBtn() {
        let btn = document.querySelector(".change-btn");
        const isTargetSet = this.targetFile?.wasParsed === true;
        const isAnySourceSet = this.files.find(({ config }) => config !== null) !== undefined;
        const isChangeable = isTargetSet && isAnySourceSet;

        if (btn === null) {
            btn = document.createElement("BUTTON");
            btn.type = "button";
            btn.className = "change-btn";
            btn.textContent = "Поменять цены";

            const parent = document.querySelector(".change-btn-wrap");
            parent.append(btn);
        }

        btn.disabled = !isChangeable;
    }

    sourceConfigChange(event) {
        const { target } = event;
        const { id, form } = target;

        if (id !== "file-config-submit") return;

        const fileConfig = document.querySelector(".file-config");

        const isFormValid = form.reportValidity();
        const checkboxes = [ ...fileConfig.querySelectorAll("input[type='checkbox']:checked") ];
        const noCheckboxChecked = checkboxes.length === 0;

        if (!isFormValid || noCheckboxChecked) {
            const checkboxGroup = document.querySelector(".file-config__checkbox-group");

            checkboxGroup.classList.toggle("file-config__checkbox-group--error", noCheckboxChecked);
            fileConfig.classList.remove("file-config--filled");

            return;
        }

        const sheets = [];
        const sheetNames = [];

        checkboxes.forEach(checkbox => {
            sheets.push( +checkbox.value );
            sheetNames.push(checkbox.dataset.name);
        });

        this.activeSourceFile.config = {};

        sheets.forEach((sheetIndex, index) => {
            const skuInput = fileConfig.querySelector(`.file-config__sku-input[data-for='${sheetIndex}']`);
            const priceInput = fileConfig.querySelector(`.file-config__price-input[data-for='${sheetIndex}']`);

            this.activeSourceFile.config[sheetIndex] = {
                sheetName:  sheetNames[index],
                sku:        +skuInput.value,
                price:      +priceInput.value,
            };
        });

        fileConfig.classList.add("file-config--filled");
        const file = document.querySelector(`.file[data-file='${this.activeSourceFile.file.name}']`);
        file.classList.add("file--config-saved");

        this.renderChangeBtn();
    }

    delBtnPointerMoveHandler(event) {
        const isPointerEnter = event.type === "pointerenter";
        const btnParent = event.target.closest(".file");

        btnParent.classList.toggle("file--del-hovered", isPointerEnter);
    }

    async changeBtnClickHandler(event) {
        const { target } = event;

        if ( target.closest(".change-btn") === null ) return;

        const isConfirmed = await this.confirm(`Вы действительно хотите поменять цены?<br><br>Будут применены следующие настройки:<br><br><table class="config-table"><tr><th>Файл</th><th>Листы</th><th>Столбец SKU</ht><th>Столбец с ценой</th></tr>${
            this.files
                .map((fileObj) => {
                    const { file, config } = fileObj;
                    const isTarget = fileObj === this.targetFile;
                    const isConfigSet = config !== null;
                    const sheets = isConfigSet ? Object.keys(config) : null;
                    const isSingleSheet = sheets?.length === 1;
                    const isMultipleSheets = sheets?.length > 1;
                    const rowClassName = isTarget
                        ? "config-table__row--t--target"
                        : !isConfigSet
                            ? "config-table__row--invalid"
                            : "config-table__row--valid";
                    let result = "";

                    result += `
                        <tr class="${rowClassName}">
                            <td ${isMultipleSheets ? `rowspan="${sheets.length}"` : ""}>
                                ${file.name}
                            </td>
                            ${isTarget
                                ? `<td>единственный</td><td>${this.targetFileSKUCol}</td><td>${this.targetFilePriceCol}</td>`
                                : !isConfigSet
                                    ? "<td colspan='3'>нет конфига для парсинга файла</td>"
                                    : sheets
                                        .map((sheet, index) => {
                                            const currentSheet = config[sheet];

                                            return `
                                                <td>${isSingleSheet && fileObj.data.length === 1 ? "единственный" : currentSheet.sheetName}</td>
                                                <td>${currentSheet.sku}</td>
                                                <td>${currentSheet.price}</td>
                                                ${isMultipleSheets && index < sheets.length - 1
                                                    ? `</tr><tr class="${rowClassName}">`
                                                    : ""
                                                }
                                            `;
                                        })
                                        .join("")
                            }
                        </tr>
                    `;

                    return result;
                })
                .join("")
        }</table>`);

        if (!isConfirmed) return;

        const sourceFiles = this.files.reduce((res, fileObj) => {
            const { config, file, data } = fileObj;

            if (config === null || fileObj === this.targetFile) return res;

            const dataToTransfer = {};
            let dataAddedCount = 0;

            for (const sheetIndex in config) {
                const respectiveData = data.find(({ index }) => index === +sheetIndex);

                if (respectiveData === undefined) continue;

                dataToTransfer[sheetIndex] = {
                    _skuCol:    config[sheetIndex].sku - 1,
                    _priceCol:  config[sheetIndex].price - 1,
                    ...respectiveData,
                };
                dataAddedCount++;
            }

            if (dataAddedCount > 0) {
                res[file.name] = dataToTransfer;
            }

            return res;
        }, {});

        const response = await ipcRenderer.invoke("changePrices", {
            workbook:       this.targetFile.workbook,
            targetData:     this.targetData,
            targetHash:     this.hash,
            targetPriceCol: this.targetFilePriceCol - 1,
            sourceFiles,
        });

        this.alert(response);
    }

    confirm(msg) {
        const dialog = document.createElement("DIV");
        dialog.className = "dialog";
        dialog.innerHTML = `
            <div class="dialog__inner">
                <button class="close dialog__close" type="button"></button>
                <div class="dialog__msg">${msg}</div>
                <button class="dialog__btn dialog__btn--t--confirm" type="button">Да</button>
                <button class="dialog__btn dialog__btn--t--decline" type="button">Нет</button>
            </div>
        `;

        const promise = new Promise(resolve => this.confirmPromiseResolve = resolve);

        document.body.append(dialog);

        return promise;
    }

    alert(msg) {
        console.log(msg);
    }

    resolveDialog(value, dialog) {
        this.confirmPromiseResolve(value);
        this.confirmPromiseResolve = null;
        dialog.remove();
    }
}