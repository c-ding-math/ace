"use strict";

var dom = require("../lib/dom");
var oop = require("../lib/oop");
var lang = require("../lib/lang");
var EventEmitter = require("../lib/event_emitter").EventEmitter;
var Lines = require("./lines").Lines;

class Gutter{
    constructor(parentEl) {
        this.element = dom.createElement("div");
        this.element.className = "ace_layer ace_gutter-layer";
        parentEl.appendChild(this.element);
        this.setShowFoldWidgets(this.$showFoldWidgets);

        this.gutterWidth = 0;

        this.$annotations = [];
        this.$updateAnnotations = this.$updateAnnotations.bind(this);

        this.$lines = new Lines(this.element);
        this.$lines.$offsetCoefficient = 1;
    };

    setSession(session) {
        if (this.session)
            this.session.off("change", this.$updateAnnotations);
        this.session = session;
        if (session)
            session.on("change", this.$updateAnnotations);
    };

    addGutterDecoration(row, className) {
        if (window.console)
            console.warn && console.warn("deprecated use session.addGutterDecoration");
        this.session.addGutterDecoration(row, className);
    };

    removeGutterDecoration(row, className) {
        if (window.console)
            console.warn && console.warn("deprecated use session.removeGutterDecoration");
        this.session.removeGutterDecoration(row, className);
    };

    setAnnotations(annotations) {
        // iterate over sparse array
        this.$annotations = [];
        for (var i = 0; i < annotations.length; i++) {
            var annotation = annotations[i];
            var row = annotation.row;
            var rowInfo = this.$annotations[row];
            if (!rowInfo)
                rowInfo = this.$annotations[row] = {text: []};
           
            var annoText = annotation.text;
            annoText = annoText ? lang.escapeHTML(annoText) : annotation.html || "";

            if (rowInfo.text.indexOf(annoText) === -1)
                rowInfo.text.push(annoText);

            var type = annotation.type;
            var className = annotation.className;
            if (className) 
                rowInfo.className = className;
            else if (type == "error")
                rowInfo.className = " ace_error";
            else if (type == "warning" && rowInfo.className != " ace_error")
                rowInfo.className = " ace_warning";
            else if (type == "info" && (!rowInfo.className))
                rowInfo.className = " ace_info";
        }
    };

    $updateAnnotations(delta) {
        if (!this.$annotations.length)
            return;
        var firstRow = delta.start.row;
        var len = delta.end.row - firstRow;
        if (len === 0) {
            // do nothing
        } else if (delta.action == 'remove') {
            this.$annotations.splice(firstRow, len + 1, null);
        } else {
            var args = new Array(len + 1);
            args.unshift(firstRow, 1);
            this.$annotations.splice.apply(this.$annotations, args);
        }
    };

    update(config) {
        this.config = config;
        
        var session = this.session;
        var firstRow = config.firstRow;
        var lastRow = Math.min(config.lastRow + config.gutterOffset,  // needed to compensate for hor scollbar
            session.getLength() - 1);
            
        this.oldLastRow = lastRow;
        this.config = config;
        
        this.$lines.moveContainer(config);
        this.$updateCursorRow();
            
        var fold = session.getNextFoldLine(firstRow);
        var foldStart = fold ? fold.start.row : Infinity;

        var cell = null;
        var index = -1;
        var row = firstRow;
        
        while (true) {
            if (row > foldStart) {
                row = fold.end.row + 1;
                fold = session.getNextFoldLine(row, fold);
                foldStart = fold ? fold.start.row : Infinity;
            }
            if (row > lastRow) {
                while (this.$lines.getLength() > index + 1)
                    this.$lines.pop();
                    
                break;
            }

            cell = this.$lines.get(++index);
            if (cell) {
                cell.row = row;
            } else {
                cell = this.$lines.createCell(row, config, this.session, onCreateCell);
                this.$lines.push(cell);
            }

            this.$renderCell(cell, config, fold, row);
            row++;
        }
        
        this._signal("afterRender");
        this.$updateGutterWidth(config);
    };

    $updateGutterWidth(config) {
        var session = this.session;
        
        var gutterRenderer = session.gutterRenderer || this.$renderer;
        
        var firstLineNumber = session.$firstLineNumber;
        var lastLineText = this.$lines.last() ? this.$lines.last().text : "";
        
        if (this.$fixedWidth || session.$useWrapMode)
            lastLineText = session.getLength() + firstLineNumber - 1;

        var gutterWidth = gutterRenderer 
            ? gutterRenderer.getWidth(session, lastLineText, config)
            : lastLineText.toString().length * config.characterWidth;
        
        var padding = this.$padding || this.$computePadding();
        gutterWidth += padding.left + padding.right;
        if (gutterWidth !== this.gutterWidth && !isNaN(gutterWidth)) {
            this.gutterWidth = gutterWidth;
            this.element.parentNode.style.width = 
            this.element.style.width = Math.ceil(this.gutterWidth) + "px";
            this._signal("changeGutterWidth", gutterWidth);
        }
    };
    
    $updateCursorRow() {
        if (!this.$highlightGutterLine)
            return;
            
        var position = this.session.selection.getCursor();
        if (this.$cursorRow === position.row)
            return;
        
        this.$cursorRow = position.row;
    };
    
    updateLineHighlight() {
        if (!this.$highlightGutterLine)
            return;
        var row = this.session.selection.cursor.row;
        this.$cursorRow = row;

        if (this.$cursorCell && this.$cursorCell.row == row)
            return;
        if (this.$cursorCell)
            this.$cursorCell.element.className = this.$cursorCell.element.className.replace("ace_gutter-active-line ", "");
        var cells = this.$lines.cells;
        this.$cursorCell = null;
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            if (cell.row >= this.$cursorRow) {
                if (cell.row > this.$cursorRow) {
                    var fold = this.session.getFoldLine(this.$cursorRow);
                    if (i > 0 && fold && fold.start.row == cells[i - 1].row)
                        cell = cells[i - 1];
                    else
                        break;
                }
                cell.element.className = "ace_gutter-active-line " + cell.element.className;
                this.$cursorCell = cell;
                break;
            }
        }
    };
    
    scrollLines(config) {
        var oldConfig = this.config;
        this.config = config;
        
        this.$updateCursorRow();
        if (this.$lines.pageChanged(oldConfig, config))
            return this.update(config);
        
        this.$lines.moveContainer(config);

        var lastRow = Math.min(config.lastRow + config.gutterOffset,  // needed to compensate for hor scollbar
            this.session.getLength() - 1);
        var oldLastRow = this.oldLastRow;
        this.oldLastRow = lastRow;
        
        if (!oldConfig || oldLastRow < config.firstRow)
            return this.update(config);

        if (lastRow < oldConfig.firstRow)
            return this.update(config);

        if (oldConfig.firstRow < config.firstRow)
            for (var row=this.session.getFoldedRowCount(oldConfig.firstRow, config.firstRow - 1); row>0; row--)
                this.$lines.shift();

        if (oldLastRow > lastRow)
            for (var row=this.session.getFoldedRowCount(lastRow + 1, oldLastRow); row>0; row--)
                this.$lines.pop();

        if (config.firstRow < oldConfig.firstRow) {
            this.$lines.unshift(this.$renderLines(config, config.firstRow, oldConfig.firstRow - 1));
        }

        if (lastRow > oldLastRow) {
            this.$lines.push(this.$renderLines(config, oldLastRow + 1, lastRow));
        }
        
        this.updateLineHighlight();
        
        this._signal("afterRender");
        this.$updateGutterWidth(config);
    };

    $renderLines(config, firstRow, lastRow) {
        var fragment = [];
        var row = firstRow;
        var foldLine = this.session.getNextFoldLine(row);
        var foldStart = foldLine ? foldLine.start.row : Infinity;

        while (true) {
            if (row > foldStart) {
                row = foldLine.end.row+1;
                foldLine = this.session.getNextFoldLine(row, foldLine);
                foldStart = foldLine ? foldLine.start.row : Infinity;
            }
            if (row > lastRow)
                break;

            var cell = this.$lines.createCell(row, config, this.session, onCreateCell);
            this.$renderCell(cell, config, foldLine, row);
            fragment.push(cell);

            row++;
        }
        return fragment;
    };
    
    $renderCell(cell, config, fold, row) {
        var element = cell.element;
        
        var session = this.session;
        
        var textNode = element.childNodes[0];
        var foldWidget = element.childNodes[1];

        var firstLineNumber = session.$firstLineNumber;
        
        var breakpoints = session.$breakpoints;
        var decorations = session.$decorations;
        var gutterRenderer = session.gutterRenderer || this.$renderer;
        var foldWidgets = this.$showFoldWidgets && session.foldWidgets;
        var foldStart = fold ? fold.start.row : Number.MAX_VALUE;
        
        var className = "ace_gutter-cell ";
        if (this.$highlightGutterLine) {
            if (row == this.$cursorRow || (fold && row < this.$cursorRow && row >= foldStart &&  this.$cursorRow <= fold.end.row)) {
                className += "ace_gutter-active-line ";
                if (this.$cursorCell != cell) {
                    if (this.$cursorCell)
                        this.$cursorCell.element.className = this.$cursorCell.element.className.replace("ace_gutter-active-line ", "");
                    this.$cursorCell = cell;
                }
            }
        }
        
        if (breakpoints[row])
            className += breakpoints[row];
        if (decorations[row])
            className += decorations[row];
        if (this.$annotations[row])
            className += this.$annotations[row].className;
        if (element.className != className)
            element.className = className;

        if (foldWidgets) {
            var c = foldWidgets[row];
            // check if cached value is invalidated and we need to recompute
            if (c == null)
                c = foldWidgets[row] = session.getFoldWidget(row);
        }

        if (c) {
            var className = "ace_fold-widget ace_" + c;
            if (c == "start" && row == foldStart && row < fold.end.row)
                className += " ace_closed";
            else
                className += " ace_open";
            if (foldWidget.className != className)
                foldWidget.className = className;

            var foldHeight = config.lineHeight + "px";
            dom.setStyle(foldWidget.style, "height", foldHeight);
            dom.setStyle(foldWidget.style, "display", "inline-block");
        } else {
            if (foldWidget) {
                dom.setStyle(foldWidget.style, "display", "none");
            }
        }
        
        var text = (gutterRenderer
            ? gutterRenderer.getText(session, row)
            : row + firstLineNumber).toString();
            
        if (text !== textNode.data) {
            textNode.data = text;
        }
        
        dom.setStyle(cell.element.style, "height", this.$lines.computeLineHeight(row, config, session) + "px");
        dom.setStyle(cell.element.style, "top", this.$lines.computeLineTop(row, config, session) + "px");
        
        cell.text = text;
        return cell;
    };

    $fixedWidth = false;
    
    $highlightGutterLine = true;
    $renderer = "";
    setHighlightGutterLine(highlightGutterLine) {
        this.$highlightGutterLine = highlightGutterLine;
    };
    
    $showLineNumbers = true;
    $renderer = "";
    setShowLineNumbers(show) {
        this.$renderer = !show && {
            getWidth: function() {return 0;},
            getText: function() {return "";}
        };
    };
    
    getShowLineNumbers() {
        return this.$showLineNumbers;
    };
    
    $showFoldWidgets = true;
    setShowFoldWidgets(show) {
        if (show)
            dom.addCssClass(this.element, "ace_folding-enabled");
        else
            dom.removeCssClass(this.element, "ace_folding-enabled");

        this.$showFoldWidgets = show;
        this.$padding = null;
    };
    
    getShowFoldWidgets() {
        return this.$showFoldWidgets;
    };

    $computePadding() {
        if (!this.element.firstChild)
            return {left: 0, right: 0};
        var style = dom.computedStyle(this.element.firstChild);
        this.$padding = {};
        this.$padding.left = (parseInt(style.borderLeftWidth) || 0)
            + (parseInt(style.paddingLeft) || 0) + 1;
        this.$padding.right = (parseInt(style.borderRightWidth) || 0)
            + (parseInt(style.paddingRight) || 0);
        return this.$padding;
    };

    getRegion(point) {
        var padding = this.$padding || this.$computePadding();
        var rect = this.element.getBoundingClientRect();
        if (point.x < padding.left + rect.left)
            return "markers";
        if (this.$showFoldWidgets && point.x > rect.right - padding.right)
            return "foldWidgets";
    };

}

oop.implement(Gutter.prototype, EventEmitter);

function onCreateCell(element) {
    var textNode = document.createTextNode('');
    element.appendChild(textNode);
    
    var foldWidget = dom.createElement("span");
    element.appendChild(foldWidget);
    
    return element;
}

exports.Gutter = Gutter;
