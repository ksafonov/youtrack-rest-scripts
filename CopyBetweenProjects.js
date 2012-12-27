var http = require('http');
var url = require('url');
var pd = require('./pretty-data.js');
var when = require('when');
var xml2js = require('xml2js');

if (!String.prototype.encodeHTML) {
    String.prototype.encodeHTML = function () {
        return this.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };
}

var proxy = {host: 'localhost', port: 8888};
var username = process.argv[2];
var password = process.argv[3];

var host = 'http://youtrack.jetbrains.com';
var sourceProject = "RUBY";
var targetProject = "WEB";
var sourceSubsystem = "CoffeeScript";
var targetSubsystem = "CoffeeScript";
var sourceFieldName = "Affected versions";
var targetFieldName = "Affected";
var max = 200;
var fieldValuePrefix = 'RubyMine';

//var host = 'http://codereview4intellij.myjetbrains.com/youtrack';
//var sourceProject = "from";
//var targetProject = "to";
//var sourceSubsystem = "Any";
//var sourceFieldName = "Affected version";
//var targetFieldName = "Affected";
//var max = 1000;
//var fieldValuePrefix = 'IDEA';


/**
 *
 * @param targetUrl
 * @param method
 * @param postData
 * @param proxy
 * @param contentType
 * @param cookies
 * @return {Promise}
 */
function executeRequest(targetUrl, method, postData, proxy, contentType, cookies) {
    var deferred = when.defer();

    var options;
    if (proxy) {
        var parsed = url.parse(targetUrl);
        options = {
            host: proxy.host,
            port: proxy.port,
            path: parsed.path,
            method: method,

            headers: {
                Host: parsed.host
            }
        };
    }
    else {
        options = url.parse(targetUrl);
        if (!options.headers) {
            options.headers = {};
        }
    }

    if (postData) {
        options.headers["Content-Length"] = postData.length;
    }
    if (contentType) {
        options.headers["Content-Type"] = contentType;
    }
    if (cookies) {
        var s = "";
        for (var i = 0; i < cookies.length; i++) {
            var items = cookies[i].split(";");
            if (s.length > 0) {
                s += "; ";
            }
            s += items[0];
        }

        options.headers['Cookie:'] = s;
    }

    var request = http.request(options, function (response) {
        var responseBody = "";
        var _cookies = response.headers['set-cookie'];
        var _location = response.headers['location'];
        var _code = response.statusCode;
        response.on('data', function (data) {
            responseBody += data;
        });
        response.on('end', function () {
            deferred.resolve({body: responseBody, cookies: _cookies, location: _location, statusCode: _code})
        });
    });
    if (postData) {
        request.write(postData);
    }
    request.end();
    return deferred.promise;
}

/**
 * @param {String} targetUrl
 * @param {Object=} proxy
 * @param cookies
 * @return {Promise} promise
 */
function executeGet(targetUrl, proxy, cookies) {
    return executeRequest(targetUrl, 'GET', null, proxy, null, cookies);
}

/**
 * @param {String} targetUrl
 * @param {String} postData
 * @param {Object=} proxy
 * @param contentType
 * @param cookies
 * @return Promise
 */
function executePost(targetUrl, postData, proxy, contentType, cookies) {
    return executeRequest(targetUrl, 'POST', postData, proxy, contentType, cookies);
}

function prettyPrint(response) {
    return pd.pd.xml(response);
}

//function loadNextChunk(cookies, startFrom) {
//    executeGet(host + '/rest/issue/byproject/' + sourceProject + '?filter=Subsystem%3A+' + subsystem + '&after=' + startFrom, proxy, cookies).then(function (response) {
//        console.log(prettyPrint(response.body));
//    });
//}


/**
 * @return {Promise}
 */
function parseXml(text) {
    var defer = when.defer();
    new xml2js.Parser().parseString(text, function (err, result) {
        if (err) {
            defer.reject(err);
        }
        else {
            defer.resolve(result);
        }
    });
    return defer.promise;
}

function getFieldValue(issue, fieldName) {
    for (var i = 0; i < issue.field.length; i++) {
        var field = issue.field[i];
        if (fieldName === field.$.name) {
            return field.value;
        }
    }
    return null;
}

/**
 * @param value
 * @return {String}
 */
function addPrefixIfNeeded(value) {
    if (value.indexOf(fieldValuePrefix) != 0) {
        return fieldValuePrefix + ' ' + value;
    } else {
        return value;
    }
}

/**
 *
 * @param issue
 * @param cookies
 * @return {Promise}
 */
function processIssue(issue, cookies) {
    var currentId = issue.$.id;
    var line = '<tr><td><a href="' + host + '/issue/' + currentId + '">' + currentId + '</a></td><td>';
    var value = getFieldValue(issue, 'Subsystem');
    if (sourceSubsystem != null) {
        var subsystem = Array.isArray(value) ? value[0] : value;
        if (sourceSubsystem != subsystem && sourceSubsystem != '{' + subsystem + '}') {
            console.log('Unexpected subsystem: ' + subsystem);
            console.flush();
            process.exit(-1);
        }
    }

    var sourceFieldValue = getFieldValue(issue, sourceFieldName);
    var targetFieldValue;
    if (sourceFieldValue == null) {
        targetFieldValue = null;
    }
    else if (Array.isArray(sourceFieldValue)) {
        targetFieldValue = '';
        for (var i = 0; i < sourceFieldValue.length; i++) {
            var v = sourceFieldValue[i];
            if (targetFieldValue.length > 0) {
                targetFieldValue += ', ';
            }
            targetFieldValue += addPrefixIfNeeded(v);
        }
    }
    else {
        targetFieldValue = addPrefixIfNeeded(sourceFieldValue);
    }
    var defer = when.defer();
    executePost(host + '/rest/issue/' + currentId + '/execute', 'command=' + targetProject + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function (response) {
        if (response.statusCode != 200) {
            line += response.body.encodeHTML() + '</td><td></td>';
            console.log(line);
            defer.resolve();
            return;
        }

        executeGet(host + '/issue/' + currentId, proxy, cookies).then(function (response) {
            var newId = response.location.substr(response.location.lastIndexOf('/') + 1);
            line += '<a href=\"' + host + '/issue/' + newId + '\">' + newId + '</a></td>';
            if (targetFieldValue != null) {
                var escapedValue = '';
                for (var i = 0; i < targetFieldValue.length; i++) {
                    escapedValue += '%' + targetFieldValue.charCodeAt(i).toString(16);
                }
                executePost(host + '/rest/issue/' + newId + '/execute', 'command=' + targetFieldName + ': ' + targetFieldValue + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function () {
                    executePost(host + '/rest/issue/' + newId + '/execute', 'command=Subsystem: ' + targetSubsystem + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function () {
                        line += '<td>' + targetFieldName + '=' + targetFieldValue + '</td></tr>';
                        console.log(line);
                        defer.resolve();
                    });
                });
            }
            else {
                executePost(host + '/rest/issue/' + newId + '/execute', 'command=Subsystem: ' + targetSubsystem + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function () {
                    line += '<td>(none)</td></tr>';
                    console.log(line);
                    defer.resolve();
                });
            }
        });
    });
    return defer.promise;
}

function logOnComplete() {
    console.log('</tbody></table>' + 'Complete, total ' + processed + ' issues, skipped ' + skipped + ' issues' + '</body></html>');
}

function processInChunks(cookies, chunkSize, delayInSeconds) {
    if (processed == max) {
        logOnComplete();
        return;
    }

    var query = host + '/rest/issue/byproject/' + sourceProject;
    query += '?filter=Subsystem%3A+' + sourceSubsystem;
    query += '&after=' + processed;
    query += '&max=' + Math.min(chunkSize, max - processed);

    var loadIssues = executeGet(query, proxy, cookies);
    loadIssues.then(function (response) {
        parseXml(response.body).then(function (xml) {
            var issues = xml.issues.issue;

            if (issues == null) {
                logOnComplete();
                return;
            }
            var i = 0;

            function takeNext() {
                if (i == issues.length) {
                    setTimeout(processInChunks(cookies, chunkSize), delayInSeconds * 1000);
                }
                else {
                    processIssue(issues[i], cookies).then(function () {
                        processed++;
                        i++;
                        takeNext();
                    });
                }

            }

            takeNext();
        });
    });
}

var processed = 0;
var skipped = 0;
var login = executePost(host + '/rest/user/login', 'login=' + username + '&password=' + password, proxy, 'application/x-www-form-urlencoded');
login.then(function (response) {
    if ('<login>ok</login>' == response.body) {
        console.log('<html><body><table><thead><tr><td>From</td><td>To</td><td>Affected</td></tr></thead><tbody>');
        processInChunks(response.cookies, 20, 20);
    }
    else {
        console.log("Failed to log in, server response: " + response.body);
    }
});

