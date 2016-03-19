// The interface for a metaparticle implementation.
// Not expected to be used, just for documentation
(function() {
        var path = require('path');
        var q = require('q');
        var exec = require('child_process');

        var util = require('./metaparticle-util');
        var docker = require('./metaparticle-docker');

        /**
         * Build all images described in this application
         * @returns A promise (using 'q') that is completed when the build is done.
         */
        module.exports.build = function() {
            var name = 'brendanburns/metaparticle'
            var host = '192.168.0.150';
	    var img = host + ":5000/" + name;

            var defer = q.defer();
            docker.buildImage(img, process.cwd()).then(function() {
		console.log('starting push');
                docker.pushImage(img, host + ":5000").then(function(data) {
		    console.log('push successful');
                    defer.resolve(data);
                }, function(err) {
		    console.log('Error pushing: ' + err);
                    defer.reject(err);
                })
            }, function(err) {
		console.log('Error building: ' + err);
	    	defer.reject(err);
	    }).done();

            return defer.promise;
        };

        /**
         * Run the described application
         */
        module.exports.run = function(services) {
            recursiveFn([], services, runKubernetesServiceReplicationController);
        };

        var recursiveFn = function(prefix, services, fn) {
            if (!services) {
                return;
            }
            for (var key in services) {
                var service = services[key];
                if (!service.subservices) {
                    fn(prefix.join('-') + '-' + service.name, service);
                } else {
                    prefix.push(service.name);
                    recursiveFn(prefix, service.subservices, fn);
                    prefix.pop();
                }
            }
        }

        var makeReplicationController = function(name, service, shard) {
	    var port = 3000;
            var rc = {
                "kind": "ReplicationController",
                "apiVersion": "v1",
                "metadata": {
                    "name": name + "." + shard,
                    "namespace": "default",
                    "labels": {
                        "shard": "" + shard,
                        "service": name
                    }
                },
                "spec": {
                    "replicas": 1,
                    "selector": {
                        "shard": "" + shard,
                        "service": name
                    },
                    "template": {
                        "metadata": {
                            "labels": {
                                "shard": "" + shard,
                                "service": name
                            }
                        },
                        "spec": {
                            "containers": [{
                                'name': service.name,
                                'image': '10.0.0.1:5000/brendanburns/metaparticle',
				'imagePullPolicy': 'Always',
                                'command': ['node', path.basename(process.argv[1]), 'serve', '' + port],
                                'ports': [{
                                    'containerPort': port
                                }]
                            }],
                            "restartPolicy": "Always",
                            "dnsPolicy": "ClusterFirst",
                        }
                    }
                },
            }
            return rc;
        };

        var makeDeployment = function(name, service) {
            var port = 3000;
            var deployment = {
                'apiVersion': 'extensions/v1beta1',
                'kind': 'Deployment',
                'metadata': {
                    'name': name
                },
                'spec': {
                    'replicas': service.replicas,
                    'template': {
                        'metadata': {
                            'labels': {
                                'app': name
                            }
                        },
                        'spec': {
                            'containers': [{
                                'name': service.name,
                                'image': '10.0.0.1:5000/brendanburns/metaparticle',
                                'command': ['node', path.basename(process.argv[1]), 'serve', '' + port],
                                'ports': [{
                                    'containerPort': port
                                }]
                            }]
                        }
                    }
                }
            };

            return deployment;
        }

        var makeService = function(name, labels) {
            var service = {
                'kind': 'Service',
                'apiVersion': 'v1',
                'metadata': {
                    'name': name
                },
                'spec': {
                    'selector': labels,
                    'ports': [{
                        'protocol': 'TCP',
                        'port': 3000,
                        'targetPort': 3000
                    }]
                }
            }

            return service;
        }

        var runKubernetesServiceDeployment = function(name, service) {
            runKubernetesCommand('kubectl create -f -', makeDeployment(name, service));
            runKubernetesCommand('kubectl create -f -', makeService(name, {
                'app': name
            }));
        };

        var runKubernetesServiceReplicationController = function(name, service) {
            for (var i = 0; i < service.replicas; i++) {
                labels = {
                    'service': name,
                    'shard': '' + i
                }
                runKubernetesCommand('kubectl create -f -', makeReplicationController(name, service, i));
                runKubernetesCommand('kubectl create -f -', makeService(name + '-' + i, labels));
            }
        };

        var runKubernetesCommand = function(cmd, obj) {
            var child = exec.exec(cmd, {}, function(err, stdout, stderr) {
                console.log(`${stdout}`);
                if (err !== null) {
                    console.log(`stderr: ${stderr}`);
                    console.log(`exec error: ${err}`);
                }
            });

            child.stdin.write(JSON.stringify(obj));
            child.stdin.end();
        };

        /**
         * Delete the described application
         */
        module.exports.delete = function(services) {
            recursiveFn([], services, deleteKubernetesServiceReplicationController);
        }

        var deleteKubernetesServiceDeployment = function(name, service) {
            runKubernetesCommand('kubectl delete -f -', makeDeployment(name, service));
            runKubernetesCommand('kubectl delete -f -', makeService(name, {
                'app': name
            }));
        };

        var deleteKubernetesServiceReplicationController = function(name, service) {
            for (var i = 0; i < service.replicas; i++) {
                runKubernetesCommand('kubectl delete -f -', makeReplicationController(name, service, i));
                runKubernetesCommand('kubectl delete -f -', makeService(name + '-' + i, {}));
       	    }
        };

            /**
             * Get the hostname of a shard in a particular service.
             * Called at runtime.
             * @param {string} serviceName The name of the service to get the hostname for.
             * @param {number} shard The integer number of the shard
             */
            module.exports.getHostname = function(serviceName, shard) {
                return serviceName.replace('.', '-') + '-' + shard + '.default.svc';
            };
        }());