var http = require('http');
var url = require('url');
var when = require('when');
var xml2js = require('xml2js');

var proxy = {host: 'localhost', port: 8888};
var username = process.argv[2];
var password = process.argv[3];

var host = 'http://youtrack.jetbrains.com';
var sourceProject = "WEB";
var sourceSubsystem = "CoffeeScript";
var sourceFieldName = "Fix versions";
var targetFieldName = "Fix in";
var max = 1000;
var fieldValuePrefix = '';

//var host = 'http://codereview4intellij.myjetbrains.com/youtrack';
//var sourceProject = "from";
//var sourceSubsystem = "Any";
//var sourceFieldName = "Affected version";
//var targetFieldName = "Affected";
//var max = 1000;
//var fieldValuePrefix = 'WebIDE';


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
        response.on('data', function (data) {
            responseBody += data;
        });
        response.on('end', function () {
            deferred.resolve({body: responseBody, cookies: _cookies, location: _location})
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
    if (fieldValuePrefix && fieldValuePrefix.length > 0 && value.indexOf(fieldValuePrefix) != 0) {
        return fieldValuePrefix + ' ' + value;
    } else {
        return value;
    }
}

function getFieldChangeValue(change, name, prop) {
    for (var i = 0; i < change.field.length; i++) {
        var field = change.field[i];
        if (field.$.name == name) {
            return field[prop];
        }
    }
    return null;
}

/**
 *
 * @param issue
 * @param cookies
 * @return {Promise}
 */
function processIssue(currentId, cookies) {
    var defer = when.defer();
    var line = '<tr><td><a href="' + host + '/issue/' + currentId + '">' + currentId + '</a></td><td>';

    executeGet(host + '/rest/issue/' + currentId + '/changes', proxy, cookies).then(function (response) {
        parseXml(response.body).then(function (xml) {
            var changes = xml.changes.change;
            if (changes.length == 0) {
                defer.resolve();
                return;
            }

            var lastChange = changes[changes.length - 1];
            var oldValue = getFieldChangeValue(lastChange, sourceFieldName, "oldValue");
            var newValue = getFieldChangeValue(lastChange, sourceFieldName, "newValue");
            if ('kirill.safonov' == getFieldChangeValue(lastChange, "updaterName", "value") && oldValue && !newValue) {
                var targetFieldValue = '';
                for (var j = 0; j < oldValue.length; j++) {
                    if (targetFieldValue.length > 0) {
                        targetFieldValue += ', ';
                    }
                    targetFieldValue += addPrefixIfNeeded(oldValue[j]);
                }
                executePost(host + '/rest/issue/' + currentId + '/execute', 'command=' + targetFieldName + ': ' + targetFieldValue + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function () {
                    line += targetFieldName + '=' + targetFieldValue + '</td></tr>';
                    console.log(line);
                    defer.resolve();
                });
            }
            else {
                line += 'skipped (source field is empty)</td></tr>';
                console.log(line);
                skipped++;
                defer.resolve();
                return defer.promise;
            }
        });
    });

//    var targetFieldValue = getFieldValue(issue, targetFieldName);
//    if (targetFieldValue != null) {
//        line += 'skipped (target field not empty)</td></tr>';
//        console.log(line);
//        skipped++;
//        defer.resolve();
//        return defer.promise;
//    }
//
//    var sourceFieldValue = getFieldValue(issue, sourceFieldName);
//    if (sourceFieldValue == null) {
//        targetFieldValue = null;
//    }
//    else if (Array.isArray(sourceFieldValue)) {
//        targetFieldValue = '';
//        for (var i = 0; i < sourceFieldValue.length; i++) {
//            var v = sourceFieldValue[i];
//            if (targetFieldValue.length > 0) {
//                targetFieldValue += ', ';
//            }
//            targetFieldValue += addPrefixIfNeeded(v);
//        }
//    }
//    else {
//        targetFieldValue = addPrefixIfNeeded(sourceFieldValue);
//    }
//
//    if (targetFieldValue != null) {
//        var escapedValue = '';
//        for (var i = 0; i < targetFieldValue.length; i++) {
//            escapedValue += '%' + targetFieldValue.charCodeAt(i).toString(16);
//        }
//        executePost(host + '/rest/issue/' + currentId + '/execute', 'command=' + targetFieldName + ': ' + targetFieldValue + '&disableNotifications=true', proxy, 'application/x-www-form-urlencoded', cookies).then(function () {
//            line += targetFieldName + '=' + targetFieldValue + '</td></tr>';
//            console.log(line);
//            defer.resolve();
//        });
//    }
//    else {
//        line += 'skipped (source field is empty)</td></tr>';
//        console.log(line);
//        skipped++;
//        defer.resolve();
//    }
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

    var query = host + '/rest/issue/byproject/' + sourceProject + '?';
    if (sourceSubsystem != null) {
        query += 'filter=Subsystem%3A+' + sourceSubsystem + '&';
    }
    query += 'after=' + processed;
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
                    setTimeout(processInChunks(cookies, chunkSize, delayInSeconds), delayInSeconds * 1000);
                }
                else {
                    processIssue(issues[i].$.id, cookies).then(function () {
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
        console.log('<html><body><table><thead><tr><td>Issue</td><td>Status</td></tr></thead><tbody>');
        processInChunks(response.cookies, 20, 20);
    }
    else {
        console.log("Failed to log in, server response: " + response.body);
    }
});

