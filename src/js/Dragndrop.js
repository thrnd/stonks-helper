module.exports = class DragNDrop {
    constructor({
        fileRegExp,
        onDragOver,
        onDragLeave,
        onDrop,
    }) {
        this.FILE_REGEXP = fileRegExp;
        this.onDragOver = onDragOver;
        this.onDrop = onDrop;

        this.onDragLeave = onDragLeave;
        this.dragMoveHandler = this.dragMoveHandler.bind(this);

        this.isDragOver = false;

        document.addEventListener("dragstart", event => event.preventDefault() );
        document.addEventListener("dragenter", this.dragMoveHandler);
        document.addEventListener("dragover",  this.dragMoveHandler);
        document.addEventListener("dragleave", (event) => {
            this.isDragOver = false;
            this.onDragLeave(event);
        });
        document.addEventListener("drop", async event => {
            event.preventDefault();

            this.isDragOver = false;

            const files = [];

            for (const file of event.dataTransfer.files) {
                const { name } = file;

                if ( name.match(this.FILE_REGEXP) ) {
                    files.push(file);
                }
            };

            this.onDrop(files);
        });
    }

    dragMoveHandler(event) {
        const isPointerOver = event.type === "dragenter" || event.type === "dragover";
        const wasDragOver = this.isDragOver;
        this.isDragOver = true;

        if (!isPointerOver) return;

        event.preventDefault();

        if (!wasDragOver) {
            this.onDragOver(event);
        }
    };
}