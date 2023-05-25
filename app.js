
const express = require('express')
const mysql = require('mysql2');

const port = 3000
const app = express();
app.use(express.json()); // for json parsing


// Create a connection to the database
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Taro7043',
  database: 'college'
});


// Connect to MySQL
connection.connect(function (err) {
    if (err) throw err;
    console.log('-Connected to MySQL');

    // Open a port for API communication
    app.listen(port, () => {
        console.log(`-Listening on http://localhost:${port}`)
    });
});


//ACL Roles
const ACCESS_LEVELS = {
    ADMIN: 'Admin',
    TEACHER: 'Teacher',
    STUDENT: 'Student'
};

// Checking access level
function checkACL(req, res, next) {
    const UserID = req.body.UserID;

    // Get the role of the user
    connection.query('SELECT Role FROM users JOIN roles ON users.RoleID = roles.RoleID WHERE UserID = ?', [UserID], function (err, results) {
        if (err) {
            console.error(err);
            return res.status(500).send('Server error');
        }

        if (results.length === 0) {
            return res.status(404).send('User not found');
        }

        req.user = {
            UserID,
            role: results[0].Role
        };

        next();
    });
}

// Restricting access for unauthorised users
function restrictTo(...accessLevels) {
    return (req, res, next) => {
        const userRole = req.user.role;
        if (!accessLevels.includes(userRole)) {
            return res.status(403).send('Access Denied');
        }

        next();
    };
}

//Functional requirement #1
//Admins should be able to enable or disable the availability of a course

// Expected JSON format of request body:
/*
{
   "UserID": 1,
   "CourseID": [2, 3, 4, 7, 8, 9, 10],
   "isAvailable": true
}
*/
app.put('/courses/availability', checkACL, restrictTo(ACCESS_LEVELS.ADMIN), (req, res) => {

    const {CourseID, isAvailable} = req.body;

    if (!Array.isArray(CourseID) || typeof isAvailable !== 'boolean') {
        return res.status(400).json({status: 'error', message: 'Invalid request'});
    }

    const query = `UPDATE courses SET isAvailable = ? WHERE CourseID IN (?)`;

    connection.query(query, [isAvailable ? 1 : 0, CourseID], function (err, result) {
        if (err) {
            console.error(err);
            return res.status(500).json({status: 'error', message: 'Server error'});
        }

        console.log(result);
        res.json({status: 'success', message: 'Courses updated successfully!'});
    });
});


//Functional requirement #2
//Admins should be able to assign one or more courses to a teacher

// Expected JSON format of request body:
/*
{
   "UserID": 2,
   "TeacherID": 3,
   "CourseID": [1, 2, 3, 4]
}
*/
app.put('/assign-courses', checkACL, restrictTo(ACCESS_LEVELS.ADMIN), (req, res) => {

    const TeacherID = req.body.TeacherID;
    const CourseID = req.body.CourseID;

    if (!TeacherID || !CourseID || !Array.isArray(CourseID)) {
        return res.status(400).json({status: 'error', message: 'Invalid request format'});
    }

    // Start the transaction
    connection.beginTransaction(err => {
        if (err) {
            console.error(err);
            return res.status(500).json({status: 'error', message: 'Error in starting transaction'});
        }

        // Remove the teacher from all courses
        connection.query('UPDATE courses SET TeacherID = 0 WHERE TeacherID = ?', [TeacherID], (err, result) => {
            if (err) {
                return connection.rollback(() => {
                    console.error(err);
                    res.status(500).json({status: 'error', message: 'Error in removing teacher from courses'});
                });
            }

            // If no courses are to be assigned, commit the transaction and return
            if (CourseID.length === 0) {
                return connection.commit(err => {
                    if (err) {
                        return connection.rollback(() => {
                            console.error(err);
                            res.status(500).json({status: 'error', message: 'Error in committing transaction'});
                        });
                    }
                    console.log(result);
                    res.json({status: 'success', message: 'Courses assigned successfully'});
                });
            }

            // Assign the teacher to the specified courses
            const placeholders = CourseID.map(() => '?').join(',');
            const values = [TeacherID, ...CourseID];
            const sql = `UPDATE courses SET TeacherID = ? WHERE CourseID IN (${placeholders})`;

            connection.query(sql, values, (err, results) => {
                if (err) {
                    return connection.rollback(() => {
                        console.error(err);
                        res.status(500).json({status: 'error', message: 'Error in assigning courses'});
                    });
                }

                connection.commit(err => {
                    if (err) {
                        return connection.rollback(() => {
                            console.error(err);
                            res.status(500).json({status: 'error', message: 'Error in committing transaction'});
                        });
                    }
                    console.log(result);
                    res.json({status: 'success', message: 'Courses assigned successfully'});
                });
            });
        });
    });
});


//Functional requirement #3
//Students can browse and list all the available courses and see the course
// title and course teacher’s name

// Expected JSON format of request body:
/*
{
   "UserID": 15
}
*/
app.get('/courses', checkACL, restrictTo(ACCESS_LEVELS.STUDENT), (req, res) => {

    const sql = `
        SELECT c.Title, u.Name AS TeacherName FROM courses c LEFT JOIN users u ON c.TeacherID = u.UserID WHERE c.TeacherID IS NOT NULL`;

    connection.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({status: 'error', message: 'Error in fetching. fetching courses'});
        }

        const courses = results.map((course, index) => ({
            index: index + 1,
            title: course.Title,
            teacher: course.TeacherName
        }));

        res.json({status: 'success', courses: courses});
    });
});


//Functional requirement #4
//Students can enrol in a course. Students should not be able to enrol
// in a course more than once at each time

// Expected JSON format of request body:
/*
{
   "UserID": 14,
   "CourseID": 3
}
*/
app.post('/enroll', checkACL, restrictTo(ACCESS_LEVELS.STUDENT), (req, res) => {

    const { UserID, CourseID } = req.body;

    if (!UserID || !CourseID) {
        return res.status(400).json({ status: 'error', message: 'User ID and Course ID are required' });
    }

    // Check if the student is already enrolled
    const checkSql = 'SELECT * FROM enrolments WHERE UserID = ? AND CourseID = ?';
    connection.query(checkSql, [UserID, CourseID], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ status: 'error', message: 'Error checking enrolment' });
        }

        if (results.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Already enrolled in the course' });
        }

        // If not enrolled, enroll the student
        const enrollSql = 'INSERT INTO enrolments (UserID, CourseID) VALUES (?, ?)';
        connection.query(enrollSql, [UserID, CourseID], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ status: 'error', message: 'Error enrolling in course' });
            }

            res.json({ status: 'success', message: 'Successfully enrolled in the course' });
        });
    });
});


//Functional requirement #5
//Teachers can fail or pass a student

// Expected JSON format of request body:
/*
{
   "UserID": 4,
   "EnrolmentID": 14,
   "Mark": 1  // 1 for pass, 0 for fail
}
*/
app.put('/mark', checkACL, restrictTo(ACCESS_LEVELS.TEACHER), (req, res) => {

    const {EnrolmentID, Mark} = req.body;

    if (Mark !== 0 && Mark !== 1) {
        return res.status(400).json({ status: 'error', message: 'Invalid mark. Mark should be either 0 or 1.'});
    }

    connection.query("SELECT * FROM enrolments WHERE EnrolmentID = ?", [EnrolmentID], function (err, enrolments) {
        if (err) {
            return res.status(500).json({ status: 'error', message: 'Error fetching enrolment.'});
        }

        if (enrolments.length == 0) {
            return res.status(400).json({ status: 'error', message: 'Enrolment does not exist.'});
        }

        connection.query("UPDATE enrolments SET Mark = ? WHERE EnrolmentID = ?", [Mark, EnrolmentID], function (err, result) {
            if (err) {
                return res.status(500).json({ status: 'error', message: 'Unable to update mark.'});
            }

            if (result.affectedRows == 0) {
                return res.status(500).json({ status: 'error', message: 'No enrolment updated. Incorrect EnrolmentID?'});
            } else {
                res.json({ status: 'success', message: 'Mark updated successfully.'});
            }
        });
    });
});

