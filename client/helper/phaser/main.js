CVS = {};

(function(){

	// constants
	var CVS_WIDTH = 640,
		CVS_HEIGHT = 480,
		WORLD_WIDTH = 960,
		WORLD_HEIGHT = 960,
		TILESIZE = 32;

	// the GAME object..... this is where it all started
	var game;

	var current_player;

	// configs and debugs
	var config = {
		players: [],
		map_items: [],
		lastClickedTile: {}
	};

	// input related
	var cursor_tile_sprite;
	keys = {};

	// --------------------------------------------------------------------------------------------------------------
	// all game related funcs START
	// ------------------------------

	function init (onAfterInit) {

		game = new Phaser.Game(CVS_WIDTH, CVS_HEIGHT, Phaser.CANVAS, 'phaser-canvas', { 
			preload: function() {
				// this is to disable pause on lost focus
				game.stage.disableVisibilityChange = true;

				// image for sprites
			    game.load.spritesheet('player','sprites/archer.png', 64, 64, 169);

			    // for tiled maps
			    game.load.tilemap('weirdmap', 'sprites/weirdmap.json', null, Phaser.Tilemap.TILED_JSON);
			    //game.load.image('simplesheet', 'sprites/simplesheet.png');
			    game.load.spritesheet('simplesheet', 'sprites/simplesheet.png', 32, 32);
			}, 
			create: function() {
				// start physics arcade engine to enable collision detection
				game.physics.startSystem(Phaser.Physics.ARCADE);

				// world setup
			    game.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

			    game.map = game.add.tilemap('weirdmap');
			    game.map.addTilesetImage('simplesheet', 'simplesheet');

			    game.layer = game.map.createLayer('layer1');

			    // add phaser astar plugin!
			    game.astar = game.plugins.add(Phaser.Plugin.PathFinderPlugin);
			    game.astar.walkables = [1];
			    game.astar.setGrid(game.map.layers[0].data, game.astar.walkables);

			    game.input.onDown.add(onClickGameWorld, this);

			    game.input.addMoveCallback(onMoveMouse, this);

			    keys.attack = game.input.keyboard.addKey(Phaser.Keyboard.SHIFT);
			    keys.attack.onDown.add(onDownAttackKey);

			   	cursor_tile_sprite = game.add.sprite(-TILESIZE, -TILESIZE, 'simplesheet', 2);

			    // do preparations of dynamic sprites at this point
			    onAfterInit();
			},
			update: function() {
				if (!current_player) return;
				// check collision between player and items
				for (var i = config.map_items.length; i--;) {
					var item = config.map_items[i];
					game.physics.arcade.overlap(current_player.sprite, item.sprite, function(player_sprite, item_sprite) {
						// apparently when you kill the sprite, it's still registered somewhere as still colliding in Phaser...
						// so first do the kill for current client, and sprite.destroy() for all clients
						item_sprite.kill();

						onCurrentPlayerHitItem(current_player, item_sprite.item);
					});
				}
			},
			render: function() {
				// DEBUG
				// if (current_player) game.debug.body(current_player.sprite);
				// if (config.map_items.length > 0) {
				// 	_.each(config.map_items, function(item) {
				// 		game.debug.body(item.sprite);
				// 	});
				// }
			} 
		});

		// DEBUG
		window.game = game;
	}

	// ------------------------------
	// all game related funcs END
	// --------------------------------------------------------------------------------------------------------------

	// --------------------------------------------------------------------------------------------------------------
	// players funcs START
	// ------------------------------

	// the Player object
	var Player = function (user, data) {
		this.game = game;
		this.data = data;
		this.user_id = user._id;

		this.sprite = game.add.sprite(this.data.pos.x*TILESIZE, this.data.pos.y*TILESIZE, 'player', 26);
		this.sprite.anchor.setTo(0.25, 0.5);

		// set physics system so that it can detect collision with item
		game.physics.enable(this.sprite, Phaser.Physics.ARCADE);
		this.sprite.body.setSize(TILESIZE, TILESIZE, TILESIZE/4, TILESIZE/2);

		this.sprite.player = this;


		// animations for walk
		this.sprite.animations.add('walk_up', getRange(1,8) , 30, true);
		this.sprite.animations.add('walk_left', getRange(13,21), 30, true);
		this.sprite.animations.add('walk_down', getRange(27,34), 30, true);
		this.sprite.animations.add('walk_right', getRange(39,47), 30, true);

		// animations for attack
		this.sprite.animations.add('attack_bow_up', getRange(104, 115), 30, true);
		this.sprite.animations.add('attack_bow_left', getRange(117, 129), 30, true);
		this.sprite.animations.add('attack_bow_down', getRange(130, 142), 30, true);
		this.sprite.animations.add('attack_bow_right', getRange(143, 155), 30, true);

		// animations for die
		this.sprite.animations.add('die', getRange(156, 161), 30, true);

		// text for username
		this.name = game.add.text(0, TILESIZE, this.data.name, { font: '16px Arial', fill: '#ffffff', align: 'center' });
		this.name.x = -(this.name.width/2) + this.sprite.width/2 - (TILESIZE/2);
		this.sprite.addChild(this.name);

		// graphic for healthbar
		this.healthbar = game.add.graphics(-TILESIZE/2, -TILESIZE);
		this.healthbar.beginFill(0xFF0000, 1);
		this.healthbar.drawRect(0, 0, 2*TILESIZE*(this.data.hp/100), 4);
		this.sprite.addChild(this.healthbar);

		// graphic for attack range
		this.attackrange = TILESIZE*6; // TODO: this can be from some dynamic data
		this.attackarea = game.add.graphics(TILESIZE/2, TILESIZE/2);
		this.attackarea.lineStyle(2, 0x0000FF, 1);
		this.attackarea.drawCircle(0, 0, this.attackrange*2);
		this.sprite.addChild(this.attackarea);
		this.attackarea.alpha = 0;

		this.state = 'active';
		this.dir = 'down';
		this.paths = [];

		return this;
	}

	/**
	* Find a path for the player from current position to end position using astar plugin (easystarjs)
	* then move it using tween
	* TODO: - animation when moving player
	**/
	Player.prototype.moveTo = function (endPos) {
		// set the state as moving to prevent attacking while moving
		this.state = 'moving';

		var self = this;
		game.astar.setCallbackFunction(function(paths) {
	    	if (paths) {
		 		
		 		// reset current paths
		 		self.paths = [];
		        for(var i = 0; i < paths.length; i++) {

		        	// find a 'joint' between paths and add it to self.paths for tween (see getDir)
	            	var path = getDir(paths, i, self);

	            	// only add tween if it returns a joint
	            	if (path) {
						var tween = game.add.tween(self.sprite);
            			tween.to({
	            			x: path.x * TILESIZE,
	            			y: path.y * TILESIZE,
	            		}, 2500/self.data.mspeed * path.dist );

            			// add an animation everytime the tween start
	            		tween.onStart.add(function() {
	            			if (self.paths[0])
	            				self.sprite.animations.play('walk_'+self.paths[0].dir);
		        		}, game);	        	

	            		// everytime a tween ends, decide whether to tween to the next joint or just stop
			        	tween.onComplete.add(function() {
			        		
			        		var dir = self.paths[0].dir;
		        			self.paths.shift();

		        			// there's still path, tween to the next
		        			if (self.paths[0]) {
		        				self.paths[0]._tween.start();
		        			} else {
		        				// reset back everything
		        				self.paths = [];
		        				self.sprite.animations.stop(null, true);
		        				self.state = 'active';
		        			}
		        		}, game);

			        	// passing path as reference
			        	tween._path = path;
		        		path._tween = tween;

		        		// add path to the paths list to make a chained tween
		        		self.paths.push(path);
	            	}
	        	}

	        	// start the first path to start the chain
	        	self.paths[0]._tween.start();
	        }
        	
	    });

		var startTile = [getTile(this.sprite.x), getTile(this.sprite.y)];
		var endTile = [endPos.x, endPos.y];

	    game.astar.preparePathCalculation(startTile, endTile);
	    
	    // we calculate the path, and when we're done the setCallback will be run with paths (if any)
	    game.astar.calculatePath();

	}

	/**
	* Stop to a nearest position when player on the move and wants to change direction
	* Player will move with tween to the nearest position and then execute Player.savePos for the new direction
	* then trigger another move
	**/
	Player.prototype.stopAtNearest = function (newPos) {
		// only do it if the paths exist
		if (!this.paths[0]) return;

		this.state = 'moving';

		var nearestTile = {};
		var duration;

		// find the coordinate of the closest tile from current location and also duration to get there
		switch (this.paths[0].dir) {
			case 'up':
				nearestTile.x = this.paths[0].x;
				nearestTile.y = Math.floor( this.sprite.y / TILESIZE );
				duration = Math.abs( this.sprite.y - (nearestTile.y * TILESIZE) ) / TILESIZE;
				break;
			case 'down':
				nearestTile.x = this.paths[0].x;
				nearestTile.y = Math.ceil( this.sprite.y / TILESIZE );
				duration = Math.abs( this.sprite.y - (nearestTile.y * TILESIZE) ) / TILESIZE;
				break;
			case 'left':
				nearestTile.y = this.paths[0].y;
				nearestTile.x = Math.floor( this.sprite.x / TILESIZE );
				duration = Math.abs( this.sprite.x - (nearestTile.x * TILESIZE) ) / TILESIZE;
				break;
			case 'right':
				nearestTile.y = this.paths[0].y;
				nearestTile.x = Math.ceil( this.sprite.x / TILESIZE );
				duration = Math.abs( this.sprite.x - (nearestTile.x * TILESIZE) ) / TILESIZE;
			break;
		}

		this.paths[0]._tween.stop();
		this.paths = [];


		// sometimes the difference between current pos and nearest tile is too small and will return the duration to zero
		// which means we don't need tween to go to nearest, just go straight away with new paths
		if (duration > 0) {
			var tween = game.add.tween(this.sprite);

			tween.to({
				x: nearestTile.x * TILESIZE,
				y: nearestTile.y * TILESIZE
			}, 2500/this.data.mspeed * duration);

			var self = this;
			tween.onComplete.add(function() {
				self.moveTo(newPos);
			}, game);

			tween.start();
		} else {
			this.moveTo(newPos);
		}
	}

	Player.prototype.shootArrow = function (pos) {
		var point = new Phaser.Point(pos.x*TILESIZE, pos.y*TILESIZE);
		var angle = point.angle(this.sprite)*180/Math.PI;
		var speed = this.data.atkspeed;

		if (Math.abs(angle) > 121) {
			dir = 'right';
		} else if (angle > 30 && angle < 121) {
			dir = 'up';
		} else if (angle < 30 && angle > -32) {
			dir = 'left';
		} else {
			dir = 'down';
		}

		setPlayerAttributeByUserId(this.user_id, {
			state : 'attack'
		});

		this.sprite.animations.play('attack_bow_'+dir, this.data.atkspeed*3, false);

		var self = this;
		setTimeout(function() {
			var arrow = new Arrow({
				player : self,
				pos: pos,
				point: point,
				angle: angle-90,
				speed : speed,
				dir : dir
			});
		}, (1/speed)*2000);
	}

	Player.prototype.getDamage = function (damage, attacking_user_id) {
		// died player shouldn't get any damage
		if (this.state === 'die') return;

		if (damage >= this.data.hp) {
			// HE'S DEAD, JIM!
			this.data.hp = 0;

			// only send the event for one user only
			// remember, we're updating every client here
			if (this.user_id === current_player.user_id) {
				onCurrentPlayerDie(this, attacking_user_id);
			}
		} else {
			this.data.hp -= damage;	
		}

		this.setHealthBar();
		this.setMessage(damage, '#ff0000');
	}

	Player.prototype.setHealthBar = function(damage) {
		this.healthbar.clear();
		this.healthbar.beginFill(0xFF0000, 1);
		this.healthbar.drawRect(0, 0, 2*TILESIZE*(this.data.hp/100), 4); // TODO: 100 should be from max_hp
	}

	Player.prototype.setMessage = function(text, color) {
		color = color || '#ffffff';
		var repeat = color === '#ff0000' ? 4 : 0; // shake the tween (with repeat) if it's a warning/damage (red color)
		var duration = repeat === 4 ? 200 : 1500;

		var self = this;
		function clearDamageText() {
			self.damagetween.stop();
			if (self.damagetext) self.damagetext.destroy();
			self.damagetext = null;
		}

		if (this.damagetween && this.damagetween) clearDamageText();

		// text for damage caption
		this.damagetext = game.add.text(TILESIZE, -TILESIZE+10, text, { font: '14px Arial', fill: color, align: 'center' });
		this.damagetext.alpha = 1;
		this.sprite.addChild(this.damagetext);

		this.damagetween = game.add.tween(this.damagetext).to({y: -TILESIZE+12}, duration, Phaser.Easing.Linear.None, true, 0, repeat, false);

		this.damagetween.onComplete.add(clearDamageText);
	}

	Player.prototype.die = function() {
		this.sprite.animations.play('die', null, false);
		this.state = 'die';

		game.add.tween(this.sprite).to({alpha: 0}, 2000, Phaser.Easing.Linear.None, true);

		var self = this;
		setTimeout(function() {
			self.revive();
		}, 5000);
	}

	Player.prototype.revive = function() {
		this.sprite.x = 0; // TODO : this one should be from random respawn places
		this.sprite.y = 0;

		this.data.hp = 100; // TODO : reset it back to max_hp
		this.setHealthBar();

		game.add.tween(this.sprite).to({alpha: 1}, 500, Phaser.Easing.Linear.None, true);

		this.state = 'active';
		// reset the frame
		this.sprite.frame = 0;
	}

	Player.prototype.getItem = function(effect) {
		effect = effect.split('+');
		var type = effect[0];
		var amount = parseInt(effect[1]);
		var text_color = '#00ff00';

		this.data[type] += amount;

		this.setMessage(type.toUpperCase() + ' + ' + amount, text_color);

		if (type === 'hp') {
			if (this.data.hp > this.data.max_hp) this.data.hp = this.data.max_hp; 
			this.setHealthBar();
		} else {
			if (this.status_arrow) this.sprite.removeChild(this.status_arrow);

			this.status_arrow = game.add.sprite(-TILESIZE/2, -TILESIZE/2, 'simplesheet', 4);
			this.sprite.addChild(this.status_arrow);
		}
	}

	Player.prototype.restoreStatus = function(type) {
		this.data[type] = this.data['max_'+type];
		this.sprite.removeChild(this.status_arrow);
		this.status_arrow = null;
	}

	// ------------------------------
	// players funcs END
	// --------------------------------------------------------------------------------------------------------------

	// --------------------------------------------------------------------------------------------------------------
	// Arrow funcs START
	// ------------------------------

	// the Arrow object
	var Arrow = function (options) {
		var distance = options.point.distance(options.player.sprite);

		var start_x = options.player.sprite.x + (dir === 'left' || dir === 'right' ? TILESIZE : TILESIZE/2);
		var start_y = options.player.sprite.y;

		// calculate the x and y middle of the destination tile
		var end_x = options.pos.x*TILESIZE + (TILESIZE/2);
		var end_y = options.pos.y*TILESIZE + (TILESIZE/2);

		this.sprite = game.add.sprite(start_x, start_y, 'simplesheet', 5);
		this.sprite.anchor.setTo(0.5, 0.5);

		this.sprite.angle = options.angle;

		var tween = game.add.tween(this.sprite);
		tween.to({
			x: end_x,
			y: end_y
		}, (30/options.speed) * distance);

		var self = this;
		tween.onComplete.add(function() {
			self.sprite.kill();
			setPlayerAttributeByUserId(options.player.user_id, {
				state : options.player.attackarea.alpha ? 'active-attack' : 'active'
			});

			// check if the arrow hit someone and only save if it's the current client
			if (options.pos.x === current_player.data.pos.x && options.pos.y === current_player.data.pos.y) {
				// send events to player events
				var attacking_player = options.player;
				onCurrentPlayerGetDamage(attacking_player);
			}
		});

		tween.start();
	}

	// ------------------------------
	// Arrow funcs END
	// --------------------------------------------------------------------------------------------------------------

	// --------------------------------------------------------------------------------------------------------------
	// Item funcs START
	// ------------------------------

	// the Item object
	var Item = function (data) {
		this.data_id = data._id;
		this.data = data;

		this.sprite = game.add.sprite(data.pos.x * TILESIZE, data.pos.y * TILESIZE, 'simplesheet', data.tilenum);
		this.sprite.item = this;

		if (this.sprite.taken) this.sprite.kill(); // kill the sprite if it's already taken

		// set physics system so that it can detect collision with player
		game.physics.enable(this.sprite, Phaser.Physics.ARCADE);

		return this;
	}

	Item.prototype.taken = function() {
		this.sprite.destroy(); // do the kill again bcs when player hits it, we maintain the visibility

		config.map_items = _.without(config.map_items, this); // exclude it from the list
	}


	// ------------------------------
	// Item funcs END
	// --------------------------------------------------------------------------------------------------------------


	// --------------------------------------------------------------------------------------------------------------
	// private funcs START
	// ------------------------------

	function randomizer (value) {
		return Math.floor( Math.random() * value );
	}

	function getTilePos (rawPos) {
		return Math.floor( rawPos / TILESIZE ) * TILESIZE;
	}

	function getTile (rawPos) {
		return Math.floor( rawPos / TILESIZE );
	}

	/**
	* Find a direction and distance from one path to another
	**/
	function getDir (paths, idx, player) {

		// since astar returns the whole tile paths, we need to check
		// whether the previous path and/or the next path is going to different directions from the current path.
		// we can also call this kind of path as 'joint'.
		// this function should return a joint with contains information to tell the player position to go (x and y),
		// direction to go (up down left right) and the distance to go based on the previous joint.
		// series of paths like this will result in a chain of position that will be useful for tweening

		// the condition so that a joint can be returned is that the path :
		// (1)	has the same x different y with the previous path, but has the same y different x with the next path 
		//		(it's moving horizontally, either right or left)
		// (2)  has the same y different x with the previous path, but has the same x different y with the next path 
		//		(it's moving vertically, either up or down)
		// (3)  is the last path, bcs ofc the last path will be the last position to tween to, but we still need to check the distance and direction

		// if those conditions aren't met, there will be no path returned, but false instead. 
		// otherwise, the joint will be returned with direction and distance inside, and the joint will be pushed to player object as reference

		// (a) 	since we never returned the first path, we can't measure distance/direction between the first joint and the player original position
		//      so we used player's original position as a reference to measure first joint

		var dir,
			dist,
			mode;

		if (idx === paths.length-1) {

			// if it's a last path, bypass the check and just return the mode
			mode = (paths[idx].x === paths[idx-1].x) ? 'vert' : 'horz';

		} else 	if ( idx === 0 ) {

			// if it's a first path just return false
			return false;

		} else if (paths[idx].x === paths[idx-1].x && paths[idx].y !== paths[idx-1].y && paths[idx].x !== paths[idx+1].x && paths[idx].y === paths[idx+1].y) {
		
			// their previous path is either up or down
			mode = 'vert';

		} else if (paths[idx].x !== paths[idx-1].x && paths[idx].y === paths[idx-1].y && paths[idx].x === paths[idx+1].x && paths[idx].y !== paths[idx+1].y) {

			// their previous path is either right or left
			mode = 'horz';

		}

		if (mode) {

			// see note (a)
			var prevPath = player.paths[player.paths.length-1] || {x: getTile(player.sprite.x), y: getTile(player.sprite.y)};

			if (mode === 'horz') {

				dir = (paths[idx].x > paths[idx-1].x) ? 'right' : 'left';
				dist = Math.abs( paths[idx].x - prevPath.x );

			} else {

				dir = (paths[idx].y > paths[idx-1].y) ? 'down' : 'up';
				dist = Math.abs( paths[idx].y - prevPath.y );

			}

			paths[idx].dir = dir;
			paths[idx].dist = dist;

			return paths[idx];

		} else {

			return false;

		}

	}

	function getRange(start, end) {
		var arr = [];
		for (var i = start; i <= end; i++) {
			arr.push(i);
		}

		return arr;
	}

	// ------------------------------
	// private funcs END
	// --------------------------------------------------------------------------------------------------------------

	// --------------------------------------------------------------------------------------------------------------
	// event funcs START
	// ------------------------------

	function onClickGameWorld (pointer) {
		if (!current_player) return;

		var newPos = {
			x: getTile(pointer.worldX),
			y: getTile(pointer.worldY)
		};

		// we shouldn't do any action if user wants to do the action on the same tile over and over
		var lastTile = config.lastClickedTile;
		if (lastTile.x === newPos.x && lastTile.y === newPos.y) return false;

		// we shouldn't save the position if user wants to do action on non-walkable areas
		var clickedTile = game.map.layer.data[newPos.y][newPos.x];
		if (!clickedTile.properties.walkable) return false;

		// allow moving only when the state is active (not attacking, etc)
		switch (current_player.state) {
			case 'active':
			case 'moving':
				onCurrentPlayerMove(newPos);

				config.lastClickedTile = newPos;
			break;
			case 'active-attack':
				var point = new Phaser.Point(newPos.x*TILESIZE, newPos.y*TILESIZE);

				// only allow the player to shoot if target is within range
				if (current_player.attackrange - point.distance(current_player.sprite) > -TILESIZE/2) {
					onCurrentPlayerAttack(newPos);
				} else {
					// trigger moving instead
					onDownAttackKey();
					onClickGameWorld(pointer);
				}
			break;
		}
	}

	function onMoveMouse (pointer, x, y) {
		if (!current_player) return;

		cursor_tile_sprite.x = getTilePos( pointer.worldX );
		cursor_tile_sprite.y = getTilePos( pointer.worldY );
	}

	function onDownAttackKey() {
		if (!current_player) return;

		// only allow attacking if the state is either active or active-attack
		if (current_player.state.indexOf('active') === -1) return;

		var new_atk_range_alpha = Math.abs(current_player.attackarea.alpha - 1);
		current_player.attackarea.alpha = new_atk_range_alpha;

		current_player.state = new_atk_range_alpha ? 'active-attack' : 'active';
	}

	function onPlayerLoggedIn(user, isCurrentUser) {
		var data = PlayerData.findOne({user_id: user._id});
		// skip everything if the data isn't there
		if (!data) {
			console.warn('No user data found.');
			return;
		}

		var player = new Player(user, data);
		config.players.push(player);

		if (isCurrentUser) {
			current_player = player;

			config.lastClickedTile = player.data.pos;

			game.camera.follow(current_player.sprite);

			// deadzone : the middle box of which the camera shouldn't scrolling
			//game.camera.deadzone = new Phaser.Rectangle(200, 150, 240, 180);
		}
	}

	function onPlayerLoggedOut(user, isCurrentUser) {
		// get the logged out user
		var logged_out_player = _.where(config.players, {
			user_id : user._id
		}, true);

		if (isCurrentUser) {
			game.camera.unfollow(current_player.sprite);
			current_player = null;
			cursor_tile_sprite.x = -TILESIZE;
			cursor_tile_sprite.y = -TILESIZE;
		}

		// remove player from canvas
		logged_out_player.sprite.kill();

		// update the array
		config.players = _.without(config.players, logged_out_player);
	}

	function onNewPlayerEvent(event) {
		if (config.players.length === 0) {
			console.warn('No players in the game');
			return;
		}

		var player = getPlayerByUserId(event.user_id);
		if (!player) {
			console.warn('Player not found.');
			return;
		}

		switch(event.type) {
			case 'move':
				var new_pos = event.attr;
				// if player.paths exist, it means it's coming from the current player itself
				if (player.paths.length > 0) {
					player.stopAtNearest(new_pos);
				} else {
					// this means move another player
					player.moveTo(new_pos);
				}

				player.data.pos = new_pos;
			break;
			case 'attack':
				if (event.attr.atk_type === 'bow') {
					player.shootArrow(event.attr.pos);
				}
			break;
			case 'get_damage':
				player.getDamage(event.attr.damage, event.attr.attacking_user_id);
			break;
			case 'die':
				player.die();
			break;
			case 'get_item':
				var item = _.where(config.map_items, {
					data_id : event.attr.item_id
				}, true);

				player.getItem(item.data.effect);

				item.taken();
			break;
			case 'restore_status' :
				player.restoreStatus(event.attr.type);
			break;
		}
	}

	function onCurrentPlayerMove(pos) {
		Meteor.call('savePlayerEvent', {
			user_id : Meteor.userId(),
			type: 'move',
			attr: pos
		})
	}

	function onCurrentPlayerAttack(pos) {
		Meteor.call('savePlayerEvent', {
			user_id: Meteor.userId(),
			type: 'attack',
			attr: {
				atk_type: 'bow', // for now
				pos: pos
			}
		});
	}

	function onCurrentPlayerGetDamage(attacking_player) {
		Meteor.call('savePlayerEvent', {
			user_id : Meteor.userId(),
			type: 'get_damage',
			attr: {
				attacking_user_id : attacking_player.user_id,
				damage : attacking_player.data.atk,
			}
		});
	}

	function onCurrentPlayerDie(died_player, killer_user_id) {
		Meteor.call('savePlayerEvent', {
			user_id: Meteor.userId(),
			type: 'die',
			attr: {
				killer_user_id: killer_user_id
			}
		});
	}

	function onInitMapItems(map_items) {
		if (!map_items || map_items.length === 0) {
			console.warn('No map items provided.');
			return;
		}

		for (var i = map_items.length; i--;) {
			var item_data = map_items[i];

			var item = new Item(item_data);
			config.map_items.push(item);
		}
	}

	function onCurrentPlayerHitItem(player, item) {
		Meteor.call('savePlayerEvent', {
			user_id: Meteor.userId(),
			type: 'get_item',
			attr: {
				item_id : item.data._id,
				effect : item.data.effect,
				next_pos : {
					x : randomizer(30),
					y : randomizer(30)
				}
			}
		});
	}

	function onReviveItem(item_data) {
		var item = new Item(item_data);
		config.map_items.push(item);
	}

	// ------------------------------
	// event funcs END
	// --------------------------------------------------------------------------------------------------------------


	function getGame() {
		return game;
	}

	function getConfig() {
		return config;
	}

	function getCurrentPlayer() {
		return current_player;
	}

	function getPlayerByUserId(user_id) {
		if (config.players.length === 0) return false;

		return _.where(config.players, {
			'user_id' : user_id
		}, true);
	}

	function setPlayerAttributeByUserId(user_id, attr) {
		var player = _.where(config.players, {
			user_id : user_id
		}, true);

		for (var key in attr) {
			if (attr.hasOwnProperty(key)) player[key] = attr[key];
		}

		return player;
	}

	// debug
	function currentPlayerGoTo(tilex, tiley) {
		onClickGameWorld({
			worldX : tilex * TILESIZE,
			worldY : tiley * TILESIZE
		});

		cursor_tile_sprite.x = tilex * TILESIZE;
		cursor_tile_sprite.y = tiley * TILESIZE;
	}


	CVS.MAIN = {
		init: init,

		getGame: getGame,
		getConfig: getConfig,
		getCurrentPlayer: getCurrentPlayer,
		getPlayerByUserId : getPlayerByUserId,

	};

	CVS.EVENT = {
		onPlayerLoggedIn : onPlayerLoggedIn,
		onPlayerLoggedOut : onPlayerLoggedOut,
		onNewPlayerEvent : onNewPlayerEvent,
		onInitMapItems : onInitMapItems,
		onReviveItem : onReviveItem
	};

	CVS.DEBUG = {
		currentPlayerGoTo : currentPlayerGoTo
	};

})();