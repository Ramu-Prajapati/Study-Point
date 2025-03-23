const { default: mongoose } = require("mongoose");
const Course = require("../models/course");
const { instance } = require("../config/razorpay");
const User = require("../models/user");
const {
  courseEnrollmentEmail,
} = require("../mail/templates/courseEnrollmentEmail");
const courseProgress = require("../models/courseProgress");
const { paymentSuccessEmail } = require("../mail/templates/paymentSuccessMail");
const crypto = require("crypto");
const mailSender = require("../utils/mailSender");
require("dotenv").config();

exports.capturePayment = async (req, res) => {
  const userId = req.user.id;
  const { courses } = req.body;

  // Here i  buy multiple courses and write toatal amount of its  on  checkout page
  // so here i calculted all the total amount of items

  if (courses.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please provide courses",
    });
  }

  // to calculate the total amount
  let totalAmount = 0;
  for (const courseId of courses) {
    console.log("Printing the course Id in Capture Payment  ", courseId);
    let course;
    try {
      // find course id

      // check in database course are exit or not ,
      course = await Course.findById(courseId);

      // if course not found then return the response
      if (!course) {
        return res.status(400).json({
          success: false,
          message: "Course Not Found",
        });
      }

      // Check if the weither the student is enrolled or not
      const uid = new mongoose.Types.ObjectId(userId);
      console.log("The StudentId is ", uid);

      // validation is must for performings any actions
      if (course.studentsEnrolled.includes(uid)) {
        return res.status(200).json({
          success: false,
          message: "Student is Already Enrolled ",
        });
      }

      totalAmount += course.price;
    } catch (error) {
      console.log(error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // create the options
  const options = {
    amount: totalAmount * 100,
    currency: "INR",
    receipt: Math.random(Date.now()).toString(),
  };

  try {
    // Initailize the payment using Razorapay
    const paymentResponse = await instance.orders.create(options);
    console.log(paymentResponse);
    res.json({
      success: true,
      data: paymentResponse,
    });
  } catch (error) {
    console.log(error);
    res
      .status(500)
      .json({ success: false, message: "Could not initiate order." });
  }
};

// verify Payment
exports.verifyPayment = async (req, res) => {
  const razorpay_order_id = req.body?.razorpay_order_id;
  const razorpay_payment_id = req.body?.razorpay_payment_id;
  const razorpay_signature = req.body?.razorpay_signature;
  const courses = req.body?.courses;

  const userId = req.user.id;

  // validation
  // validation put each and every step so , u do not lazy in putting validation in each fucntion
  // and when u make any function always check about validation.
  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature ||
    !courses ||
    !userId
  ) {
    return res.status(200).json({
      success: false,
      message: "Payment Failed",
    });
  }

  // Here in the below line u see the pipe beacause its mention in razorpay documentation
  // so not need to learn everythings .
  let body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(body.toString())
    .digest("hex");

  console.log("Generated Signature:", expectedSignature);
  console.log("Received Signature:", razorpay_signature);

  if (expectedSignature === razorpay_signature) {
    await enrollStudent(courses, userId, res); // Don't send another response here
    return;
  }

  return res.status(200).json({
    success: false,
    message: " Payment Failed",
  });
};

const enrollStudent = async (courses, userId, res) => {
  try {
    if (!courses || !userId) {
      return res.status(400).json({
        success: false,
        message: "Please provide Course ID and User ID",
      });
    }

    for (const courseId of courses) {
      console.log("Enrolling Student for Course ID:", courseId);

      // Step 1: Update course to add the student
      const enrolledCourse = await Course.findOneAndUpdate(
        { _id: courseId },
        { $addToSet: { studentsEnrolled: userId } }, // Use $addToSet to avoid duplicates
        { new: true }
      );

      if (!enrolledCourse) {
        console.error(`Course not found for ID: ${courseId}`);
        return res.status(400).json({
          success: false,
          message: "Course not found",
        });
      }

      console.log("Updated Course:", enrolledCourse);

      // Step 2: Create course progress entry
      const courseProgressDetails = await courseProgress.create({
        courseID: courseId,
        userId: userId,
        completedVideos: [],
      });

      // Step 3: Update the student's enrolled courses list
      const enrolledStudent = await User.findByIdAndUpdate(
        userId,
        {
          $addToSet: {
            courses: courseId, // Prevent duplicate courses
            courseProgress: courseProgressDetails._id,
          },
        },
        { new: true }
      );

      console.log("Updated Student:", enrolledStudent);

      // Step 4: Send email confirmation
      if (enrolledStudent?.email) {
        await mailSender(
          enrolledStudent.email,
          `Successfully Enrolled in ${enrolledCourse.courseName}`,
          courseEnrollmentEmail(
            enrolledCourse.courseName,
            `${enrolledStudent.firstName} ${enrolledStudent.lastName}`
          )
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Student enrolled successfully",
    });
  } catch (error) {
    console.error("Error in enrollStudent:", error);
    return res.status(500).json({
      success: false,
      message: "Error enrolling student",
      error: error.message,
    });
  }
};

// Send Payment Success Email
exports.sendPaymentSuccessEmail = async (req, res) => {
  const { orderId, paymentId, amount } = req.body;

  const userId = req.user.id;

  if (!orderId || !paymentId || !amount || !userId) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide all the details" });
  }

  try {
    const enrolledStudent = await User.findById(userId);

    await mailSender(
      enrolledStudent.email,
      `Payment Received`,
      paymentSuccessEmail(
        `${enrolledStudent.firstName} ${enrolledStudent.lastName}`,
        amount / 100,
        orderId,
        paymentId
      )
    );
  } catch (error) {
    console.log("error in sending mail", error);
    return res
      .status(400)
      .json({ success: false, message: "Could not send email" });
  }
};
